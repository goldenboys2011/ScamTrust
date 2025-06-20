import {logChannel} from "./discordBot.js"

export const color = {
  red: 0xff0000,
  green: 0x00ff00,
  yellow: 0xffff00,
  blue: 0x3498db,
  purple: 0x9b59b6,
  orange: 0xe67e22,
  gray: 0x95a5a6,
  white: 0xffffff,
  black: 0x000000
};

export default async function log(procces, message, color){
    console.log(`[${procces}] ${message}`);

    if (!logChannel) {
        console.warn(`[Logger] ❌ Log channel is not ready yet!`);
        return;
    }

    const embed = {
        title: `ScamTrust Log [${procces}]`,
        color: color,
        fields: [
            { name: '['+procces+"]", value: message },
            { name: "At ", value: new Date().toISOString() },
        ],
        timestamp: new Date().toISOString()
    };

    await logChannel.send({ embeds: [embed] });
}