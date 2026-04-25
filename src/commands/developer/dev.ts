import "dotenv/config";
import { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, AttachmentBuilder } from "discord.js";
import { prisma } from "../../db.js";
import { client } from "../../index.js";
import { buildLeaderboardCanvas } from "../stats/canvas.js";
import { checkWebsite, checkBot, checkLastfm, checkDatabase } from "../../../server/healthChecks.js";
import type { Command } from "../../index.js";

const DEV_IDS = new Set(['860384146778226699']);

function deny(interaction: any) {
  return interaction.reply({ content: '🚫 Developer only.', ephemeral: true });
}

function line(label: string, value: string) {
  return `**${label}:** ${value}`;
}

export const devCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Developer tools')
    .addSubcommand(s => s.setName('stats').setDescription('Bot runtime stats'))
    .addSubcommand(s => s.setName('status').setDescription('Service health check'))
    .addSubcommand(s => s.setName('cache').setDescription('Cache table row counts'))
    .addSubcommand(s =>
      s.setName('user')
        .setDescription('Look up a user in the DB')
        .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('lookup')
        .setDescription('Look up a Last.fm username in the DB')
        .addStringOption(o => o.setName('username').setDescription('Last.fm username').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('eval')
        .setDescription('Evaluate a JS expression')
        .addStringOption(o => o.setName('code').setDescription('JS code to evaluate').setRequired(true))
    )
    .addSubcommand(s => s.setName('testcanvas').setDescription('Render a test leaderboard canvas')),

  async execute(interaction) {
    if (!DEV_IDS.has(interaction.user.id)) return deny(interaction);

    const sub = interaction.options.getSubcommand();

    // ── stats ──────────────────────────────────────────────────────────────────
    if (sub === 'stats') {
      await interaction.deferReply({ ephemeral: true });
      const uptimeSecs = Math.floor(process.uptime());
      const h = Math.floor(uptimeSecs / 3600);
      const m = Math.floor((uptimeSecs % 3600) / 60);
      const s = uptimeSecs % 60;
      const mem = process.memoryUsage();
      const toMB = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';

      const lines = [
        `### 🤖 Bot Stats`,
        line('Uptime', `${h}h ${m}m ${s}s`),
        line('Guilds', client.guilds.cache.size.toString()),
        line('Ping', `${client.ws.ping}ms`),
        line('Heap used', toMB(mem.heapUsed)),
        line('Heap total', toMB(mem.heapTotal)),
        line('RSS', toMB(mem.rss)),
        line('Node', process.version),
      ].join('\n');

      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── status ─────────────────────────────────────────────────────────────────
    else if (sub === 'status') {
      await interaction.deferReply({ ephemeral: true });
      const results = await Promise.all([checkWebsite(), checkBot(client), checkLastfm(), checkDatabase(prisma as any)]);
      const emoji = (s: string) => s === 'operational' ? '🟢' : s === 'degraded' ? '🟡' : '🔴';

      const lines = [
        `### 🔍 Service Status`,
        ...results.map(r => `${emoji(r.status)} **${r.service}** — ${r.status} (${r.responseTime}ms)`),
      ].join('\n');

      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── cache ──────────────────────────────────────────────────────────────────
    else if (sub === 'cache') {
      await interaction.deferReply({ ephemeral: true });
      const db = prisma as any;
      const [recent, tasteUser, tasteServer, scrobbles, artists, albums, genres, wk, wrapped] = await Promise.all([
        db.recentCache.count(),
        db.tasteUserCache.count(),
        db.tasteServerCache.count(),
        db.statsScrobblesCache.count(),
        db.statsArtistsCache.count(),
        db.statsAlbumsCache.count(),
        db.statsGenresCache.count(),
        db.wkCache.count(),
        db.wrappedCache.count(),
      ]);

      const lines = [
        `### 🗄️ Cache Rows`,
        line('RecentCache', recent),
        line('TasteUserCache', tasteUser),
        line('TasteServerCache', tasteServer),
        line('StatsScrobblesCache', scrobbles),
        line('StatsArtistsCache', artists),
        line('StatsAlbumsCache', albums),
        line('StatsGenresCache', genres),
        line('WkCache', wk),
        line('WrappedCache', wrapped),
      ].join('\n');

      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── user ───────────────────────────────────────────────────────────────────
    else if (sub === 'user') {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getUser('user', true);
      const dbUser = await prisma.user.findUnique({
        where: { discordId: target.id },
        include: { servers: { include: { server: true } } },
      });

      if (!dbUser) {
        const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`❌ No DB record for <@${target.id}>`));
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      const lines = [
        `### 👤 User — ${target.username}`,
        line('DB ID', dbUser.id),
        line('Discord ID', dbUser.discordId),
        line('Last.fm', dbUser.lastfmUsername ?? '—'),
        line('Session key', dbUser.sessionKey ? '✅ set' : '❌ not set'),
        line('Servers', dbUser.servers.map(s => s.server.name).join(', ') || '—'),
        line('Created', dbUser.createdAt.toISOString()),
      ].join('\n');

      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── lookup ─────────────────────────────────────────────────────────────────
    else if (sub === 'lookup') {
      await interaction.deferReply({ ephemeral: true });
      const username = interaction.options.getString('username', true);
      const dbUser = await prisma.user.findFirst({
        where: { lastfmUsername: { equals: username, mode: 'insensitive' } },
        include: { servers: { include: { server: true } } },
      });

      if (!dbUser) {
        const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`❌ No user found with Last.fm username **${username}**`));
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      const lines = [
        `### 🔎 Lookup — ${username}`,
        line('Discord', `<@${dbUser.discordId}> (${dbUser.username})`),
        line('DB ID', dbUser.id),
        line('Session key', dbUser.sessionKey ? '✅ set' : '❌ not set'),
        line('Servers', dbUser.servers.map(s => s.server.name).join(', ') || '—'),
        line('Created', dbUser.createdAt.toISOString()),
      ].join('\n');

      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── eval ───────────────────────────────────────────────────────────────────
    else if (sub === 'eval') {
      await interaction.deferReply({ ephemeral: true });
      const code = interaction.options.getString('code', true);
      let result: string;
      try {
        // eslint-disable-next-line no-eval
        let output = eval(code);
        if (output instanceof Promise) output = await output;
        result = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
      } catch (err: any) {
        result = `❌ ${err?.message ?? err}`;
      }
      const truncated = result.length > 1800 ? result.slice(0, 1800) + '\n...(truncated)' : result;
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ⚡ Eval\n\`\`\`js\n${code}\n\`\`\`\n**Output:**\n\`\`\`\n${truncated}\n\`\`\``)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // ── testcanvas ─────────────────────────────────────────────────────────────
    else if (sub === 'testcanvas') {
      await interaction.deferReply({ ephemeral: true });
      const testMembers = [
        { username: 'testuser1', count: 1000, displayCount: '1,000' },
        { username: 'testuser2', count: 800,  displayCount: '800' },
        { username: 'testuser3', count: 600,  displayCount: '600' },
        { username: 'testuser4', count: 400,  displayCount: '400' },
        { username: 'testuser5', count: 200,  displayCount: '200' },
      ];
      const buf = await buildLeaderboardCanvas(testMembers, 'Test Server', 'plays', 'Canvas render test', 0);
      const attachment = new AttachmentBuilder(buf, { name: 'testcanvas.png' });
      await interaction.editReply({ files: [attachment] });
    }
  },
};
