import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import fetch from 'node-fetch';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

// Load config
const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));

// Initialize Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
    .toJSON()
];


// Login the client first to get the client ID dynamically
client.once('ready', async () => {
  console.log(`🤖 Discord bot ready as ${client.user.tag}`);

  // Register global slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);
    await rest.put(
      Routes.applicationCommands(client.user.id), // Global commands
      { body: commands }
    );
    console.log('✅ Successfully registered global slash commands.');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
});

// Handle commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addscammer') {
    const discordId = interaction.options.getString('discord');
    const redditUsername = interaction.options.getString('reddit');
    const displayName = interaction.options.getString('display');
    const note = interaction.options.getString('note');

    const res = await fetch('http://localhost:3000/scammer/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.authToken
      },
      body: JSON.stringify({ discordId, redditUsername, displayName, note })
    });

    if (res.ok) {
      if (discordId) {
        try {
          const guilds = await client.guilds.fetch();
          for (const [guildId] of guilds) {
            const guild = await client.guilds.fetch(guildId);
            try {
              const rawDiscordId = discordId?.replace(/^<@!?(\d+)>$/, '$1') || discordId;
              await guild.members.ban(rawDiscordId, { reason: `Scammer: ${note}` });
              console.log(`Banned ${discordId} from ${guild.name}`);
              await interaction.reply({ content: `<:bannHammer:1384965904650997881> Banned ${discordId} from ${guild.name}`, ephemeral: true });
            } catch (e) {
              console.warn(`⚠️ Could not ban ${discordId} from ${guild.name}:`, e.message);
              await interaction.reply({ content: `⚠️ Could not ban ${discordId} from ${guild.name}: ${e.message}`, ephemeral: true });
            }
          }
        } catch (e) {
          console.warn(`⚠️ Could not fetch guilds:`, e.message);
        }
      }
    } else {
      await interaction.reply({ content: 'Failed to add scammer.', ephemeral: true });
    }
  }

  // =====SCAMMER GET COMMAND=====
  if (interaction.commandName === 'scammer') {
    const id = interaction.options.getString('id');

    try {
      let url = 'http://localhost:3000/scammers';
      if (id) url = `http://localhost:3000/scammer/${encodeURIComponent(id)}`;

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
      console.error('Error fetching scammer data:', error);
      await interaction.reply({ content: '❌ Internal error occurred.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'reportscammer') {
    const displayName = interaction.options.getString('display');
    const scam = interaction.options.getString('scam');
    const proof = interaction.options.getAttachment('proof');
    const discord = interaction.options.getString('discord');
    const reddit = interaction.options.getString('reddit');
    
    const proofUrl = proof.url

    const res = await fetch('http://localhost:3000/report/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.authToken
      },
      body: JSON.stringify({ discord, reddit, displayName, scam, proofUrl })
    });

    const embed = new EmbedBuilder()
      .setTitle('🚨 Scammer Report Submitted')
      .addFields(
        { name: 'Display Name', value: displayName },
        { name: 'Scam Details', value: scam },
        { name: 'Discord ID', value: discord || 'N/A', inline: true },
        { name: 'Reddit', value: reddit || 'N/A', inline: true },
        {name: 'Proof: ', value: ""}
      )
      .setImage(proofUrl)
      .setColor(0xff0000);

    return interaction.reply({ embeds: [embed] });
  }

});

// Start bot
client.login(config.discordToken);
