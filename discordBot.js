import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import fetch from 'node-fetch';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import log,{ color } from './logger.js';

let discordStatus = 'starting'; // or 'running', 'error', etc.

function setDiscordStatus(status) {
  discordStatus = status;
}

export function getDiscordStatus() {
  return discordStatus;
}

function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

// Load config
const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));

// Initialize Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export let logChannel = null;

// Define commands
const commands = [
  new SlashCommandBuilder()
    .setName('addscammer')
    .setDescription('Add a scammer to the system')
    .addStringOption(opt => opt.setName('display').setDescription('Display name').setRequired(true))
    .addStringOption(opt => opt.setName('note').setDescription('Reason').setRequired(true))
    .addStringOption(opt => opt.setName('discord').setDescription('Discord ID').setRequired(false))
    .addStringOption(opt => opt.setName('reddit').setDescription('Reddit username').setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('scammer')
    .setDescription('Show a the list of scammers or specific scmammer')
    .addStringOption(opt => opt.setName('id').setDescription('ScammerId').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reportscammer')
    .setDescription('Report Scammer to moderators')
    .addStringOption(opt => opt.setName('display').setDescription('Display name').setRequired(true))
    .addStringOption(opt => opt.setName('scam').setDescription('Scam reason').setRequired(true))
    .addAttachmentOption(opt => opt.setName('proof').setDescription('Scam Proof (screenshot)').setRequired(true))
    .addStringOption(opt => opt.setName('discord').setDescription('Discord ID').setRequired(false))
    .addStringOption(opt => opt.setName('reddit').setDescription('Reddit username').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Get ScamTrust Service Status')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Get ScamTrust Service Status')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Scan scam history of a Discord user')
    .addStringOption(opt => opt.setName('user').setDescription('Discord mention or ID').setRequired(true))
    .toJSON(),
];


// Login the client first to get the client ID dynamically
client.once('ready', async () => {
  setDiscordStatus('running');
  logChannel = await client.channels.fetch('1385671892475576491').catch(err => {
    console.error('[Discord] ❌ Failed to fetch log channel:', err.message);
  });
  log("Discord",`🤖 Discord bot ready as ${client.user.tag}`,color.green);

  // Register global slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);
    await rest.put(
      Routes.applicationCommands(client.user.id), // Global commands
      { body: commands }
    );
    log("Discord", '✅ Successfully registered global slash commands.', color.green);
  } catch (error) {
    log("Discord", '❌ Error registering commands: '+ error, color.red);
  }
});

// Handle commands
client.on('interactionCreate', async interaction => {
  try{
    log("Discord", "Interaction", color.gray)
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'scan') {
      await interaction.deferReply();
      await wait(4_000);
		  await interaction.editReply('Pong!');
    }

    if (interaction.commandName === 'ping' || interaction.commandName === 'status') {
      try {
        const statusRes = await fetch('http://localhost:4729/status');
        const statusJson = await statusRes.json();

        const statusDot = (status) => {
          switch (status) {
            case 'running': return '🟢';
            case 'starting': return '🟡';
            case 'error': return '🔴';
            default: return '⚪';
          }
        };

        const coreServices = ['discordBot', 'redditBot', 'api'];
        const coreLines = [];
        const apiLines = [];

        for (const service of statusJson.services) {
          const line = `${statusDot(service.status)} \`${service.name}\` — ${service.status}`;
          
          if (coreServices.includes(service.name)) {
            if(service.name == "api") service.name = "API"
            coreLines.push(`${statusDot(service.status)} **${capitalizeFirstLetter(service.name)}** — ${service.status}`);
          } else {
            apiLines.push(line);
          }
        }

        const embed = {
          title: 'ScamTrust Services Status',
          description: `### Core Services\n${coreLines.join('\n')}\n\n### API Endpoints\n${apiLines.join('\n')}`,
          color: 0x00aaff,
          timestamp: new Date().toISOString()
        };

        await interaction.reply({ embeds: [embed] });

      } catch (err) {
        log("Discord", 'Failed to fetch status: '+ err, color.green);
        await interaction.reply({
          content: '⚠️ Failed to fetch status from API.',
          ephemeral: true
        });
      }
    }

    if (interaction.commandName === 'addscammer') {
      const discordId = interaction.options.getString('discord');
      const redditUsername = interaction.options.getString('reddit');
      const displayName = interaction.options.getString('display');
      const note = interaction.options.getString('note');

      // Step 1: Check if the command user is a verified admin
      const adminRes = await fetch('http://localhost:4729/admins', {
        headers: {
          'Authorization': config.authToken
        }
      });

      if (!adminRes.ok) {
        return await interaction.reply({
          content: '❌ Could not verify admin list. Try again later.',
          ephemeral: true
        });
      }

      const adminList = await adminRes.json();
      const adminIds = adminList.map(admin => admin.id);

      if (!adminIds.includes(interaction.user.id)) {
        return await interaction.reply({
          content: '❌ You are not a verified admin and cannot use this command.',
          ephemeral: true
        });
      }

      // Step 2: Add scammer to DB
      const res = await fetch('http://localhost:4729/scammer/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.authToken
        },
        body: JSON.stringify({ discordId, redditUsername, displayName, note })
      });

      if (res.ok) {
        if (discordId) {
          const guild = interaction.guild;
          if (!guild) {
            return await interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
          }

          try {
            const rawDiscordId = discordId.replace(/^<@!?(\d+)>$/, '$1');
            await guild.members.ban(rawDiscordId, { reason: `Scammer: ${note}` });
            log("Discord", `✅ Banned ${rawDiscordId} from ${guild.name}`, color.green);
            await interaction.reply({
              content: `<:bannHammer:1384965904650997881> Banned <@${rawDiscordId}> from **${guild.name}**`
            });
          } catch (e) {
            log("Discord", `⚠️ Could not ban ${discordId} from ${guild.name}: `+ e.message, color.red);
            await interaction.reply({
              content: `⚠️ Could not ban <@${discordId}> from **${guild.name}**: ${e.message}`,
              ephemeral: true
            });
          }
        } else {
          await interaction.reply({
            content: 'ℹ️ Scammer added without Discord ID. No ban performed.',
            ephemeral: true
          });
        }

        const alertChannelId = '1378652997692948590';
        const alertChannel = await client.channels.fetch(alertChannelId);

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = {
            title: '🚨 Scammer Alert',
            color: 0xff0000,
            fields: [
              { name: 'Discord ID', value: discordId || 'N/A', inline: true },
              { name: 'Reddit Username', value: redditUsername || 'N/A', inline: true },
              { name: 'Display Name', value: displayName || 'N/A', inline: true },
              { name: 'Note', value: note || 'N/A' },
              { name: 'Symbited By Admin', value: `<@${interaction.user.id}>`, inline: false}
            ],
            timestamp: new Date().toISOString()
          };

          await alertChannel.send({ embeds: [embed] });
        }
      } else {
        await interaction.reply({ content: '❌ Failed to add scammer to the database.', ephemeral: true });
      }
    }


    // =====SCAMMER GET COMMAND=====
    if (interaction.commandName === 'scammer') {
      const id = interaction.options.getString('id');

      try {
        let url = 'http://localhost:4729/scammers';
        if (id) url = `http://localhost:4729/scammer/${encodeURIComponent(id)}`;

        const res = await fetch(url, {
          headers: { 'Authorization': config.authToken }
        });

        if (!res.ok) {
          if (res.status === 404) {
            return interaction.reply({ content: `❌ No scammer found with ID \`${id}\``, ephemeral: true });
          }
          return interaction.reply({ content: `❌ Failed to fetch scammer data.`, ephemeral: true });
        }

        const data = await res.json();

        if (id) {
          // === Single scammer info ===
          const scammer = data;
          const embed = new EmbedBuilder()
            .setTitle('📋 Scammer Info')
            .setColor(0xff0000)
            .addFields(
              { name: 'ID', value: scammer.id, inline: false },
              { name: 'Display Name', value: scammer.displayName || 'N/A', inline: true },
              { name: 'Discord ID', value: scammer.discordId || 'N/A', inline: true },
              { name: 'Reddit Username', value: scammer.redditUsername || 'N/A', inline: true },
              { name: 'Note', value: scammer.note || 'N/A', inline: false }
            );

          return interaction.reply({ embeds: [embed], ephemeral: false });
        } else {
          // === Multiple scammers ===
          const scammers = data;
          if (!Array.isArray(scammers) || scammers.length === 0) {
            return interaction.reply({ content: 'No scammers found.', ephemeral: true });
          }

          const pageSize = 8;
          const pages = Math.ceil(scammers.length / pageSize);

          const makeEmbed = (page) => {
            const embed = new EmbedBuilder()
              .setTitle(`📋 Scammer List (Page ${page + 1} of ${pages})`)
              .setColor(0xff9900)
              .setFooter({ text: `Showing ${pageSize} per page.` });

            const start = page * pageSize;
            const slice = scammers.slice(start, start + pageSize);
            slice.forEach((scammer, i) => {
              embed.addFields({
                name: `${i + 1 + start}. ${scammer.displayName || 'Unnamed'}`,
                value: [
                  `Discord: ${scammer.discordId || 'N/A'}`,
                  `Reddit: ${scammer.redditUsername || 'N/A'}`,
                  `Note: ${scammer.note || 'No note'}`,
                  '```',
                  scammer.id,
                  '```'
                ].join('\n'),
                inline: false
              });
            });

            return embed;
          };

          const getButtons = (page, userId) => {
            return new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`prev_${page}_${userId}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId(`next_${page}_${userId}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === pages - 1)
            );
          };

          const initialPage = 0;
          await interaction.reply({
            embeds: [makeEmbed(initialPage)],
            components: pages > 1 ? [getButtons(initialPage, interaction.user.id)] : [],
            ephemeral: false
          });

          // Button interaction collector
          const msg = await interaction.fetchReply();
          const collector = msg.createMessageComponentCollector({ time: 2 * 60 * 1000 });

          collector.on('collect', async btnInteraction => {
            const [action, oldPageStr, userId] = btnInteraction.customId.split('_');
            if (btnInteraction.user.id !== userId) {
              return btnInteraction.reply({ content: '❌ These buttons are not for you.', ephemeral: true });
            }

            let page = parseInt(oldPageStr);
            if (action === 'next') page++;
            if (action === 'prev') page--;

            await btnInteraction.update({
              embeds: [makeEmbed(page)],
              components: [getButtons(page, userId)]
            });
          });

          collector.on('end', async () => {
            try {
              await msg.edit({ components: [] });
            } catch (_) {}
          });
        }
      } catch (error) {
        log("Discord", 'Error fetching scammer data: '+ error, color.red);
        await interaction.reply({ content: '❌ Internal error occurred.', ephemeral: true });
      }
    }

    if (interaction.commandName === 'reportscammer') {
      const displayName = interaction.options.getString('display');
      const scam = interaction.options.getString('scam');
      const proof = interaction.options.getAttachment('proof');
      const discord = interaction.options.getString('discord');
      const reddit = interaction.options.getString('reddit');
      const proofUrl = proof?.url;

      const res = await fetch('http://localhost:4729/report/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.authToken
        },
        body: JSON.stringify({ discord, reddit, displayName, scam, proofUrl })
      });

      // Confirmation Embed
      const userEmbed = new EmbedBuilder()
        .setTitle('🚨 Scammer Report Submitted')
        .addFields(
          { name: 'Display Name', value: displayName },
          { name: 'Scam Details', value: scam },
          { name: 'Discord ID', value: discord || 'N/A', inline: true },
          { name: 'Reddit', value: reddit || 'N/A', inline: true },
          { name: 'Proof', value: proofUrl || 'N/A' }
        )
        .setImage(proofUrl)
        .setColor(0xff0000);

      await interaction.reply({ embeds: [userEmbed], ephemeral: true });

      // Review Embed
      const modEmbed = new EmbedBuilder()
        .setTitle('🛡️ New Scammer Report - Pending Review')
        .addFields(
          { name: 'Display Name', value: displayName },
          { name: 'Scam Details', value: scam },
          { name: 'Discord ID', value: discord || 'N/A', inline: true },
          { name: 'Reddit', value: reddit || 'N/A', inline: true },
          { name: 'Submitted by', value: `<@${interaction.user.id}>` },
          { name: "Proof", value: ""}
        )
        .setImage(proofUrl)
        .setColor(0xffcc00)
        .setTimestamp();

      // Buttons
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('approve_report')
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('decline_report')
          .setLabel('❌ Decline')
          .setStyle(ButtonStyle.Danger)
      );

      // Send to mod review channel
      const reviewChannel = await client.channels.fetch('1385284951771189308');
      const modMessage = await reviewChannel.send({
        content: "<@&1378520140831789128>",
        embeds: [modEmbed],
        components: [buttons]
      });

      // Collector
      const collector = modMessage.createMessageComponentCollector({ time: 60 * 60 * 1000 }); // 1 hour

      collector.on('collect', async (btnInt) => {
        if (!btnInt.memberPermissions?.has('BanMembers')) {
          return btnInt.reply({ content: '❌ You lack permission.', ephemeral: true });
        }

        const rawDiscordId = discord?.replace(/^<@!?(\d+)>$/, '$1') || discord;

        if (btnInt.customId === 'approve_report') {
          // Add scammer
          await fetch('http://localhost:4729/scammer/add', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': config.authToken
            },
            body: JSON.stringify({
              discordId: rawDiscordId,
              redditUsername: reddit,
              displayName,
              note: scam
            })
          });

          // Ban from current guild (where command was used)
          try {
            const guild = interaction.guild;
            if (guild) {
              await guild.members.ban(rawDiscordId, { reason: `Scammer: ${scam}` });
            }
          } catch (err) {
            log("Discord",'⚠️ Ban failed: '+ err.message, color.yellow);
          }

          // Send alert embed to scammer channel
          const scammerAlertEmbed = new EmbedBuilder()
            .setTitle('🚨 Scammer Alert')
            .addFields(
              { name: 'Display Name', value: displayName },
              { name: 'Discord ID', value: discord || 'N/A', inline: true },
              { name: 'Reddit Username', value: reddit || 'N/A', inline: true },
              { name: 'Reason', value: scam },
              { name: 'Reported By', value: `<@${interaction.user.id}>` }
            )
            .setImage(proofUrl)
            .setColor(0xff0000)
            .setTimestamp();

          const scammerAlertChannel = await client.channels.fetch('1378652997692948590');
          if (scammerAlertChannel && scammerAlertChannel.isTextBased()) {
            await scammerAlertChannel.send({ embeds: [scammerAlertEmbed] });
          }

          // DM the reporter
          try {
            await interaction.user.send('✅ Your scammer report has been **approved**, the user has been **banned**, and the report was logged.');
          } catch (e) {
            log("Discord", '⚠️ Failed to DM user: '+ e.message, color.yellow);
          }

          await btnInt.update({ content: '✅ Report approved. Scammer added, banned, and alert sent.', components: [] });
        }

        if (btnInt.customId === 'decline_report') {
          try {
            await interaction.user.send('❌ Your scammer report has been reviewed but was **declined** by a moderator.');
          } catch (e) {
            log("Discord", '⚠️ Failed to DM user: '+ e.message, color.yellow);
          }

          await btnInt.update({ content: '❌ Report declined.', components: [] });
        }

        collector.stop();
      });
    }
  }
  catch(e){
    log("Discord",e, color.red)
    setDiscordStatus("error")
  }
});

// Start bot
client.login(config.discordToken);
