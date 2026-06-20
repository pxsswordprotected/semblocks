import { NextResponse } from "next/server";
import {
  ArenaError,
  getChannelContents,
  getUser,
  getUserChannels,
  isArenaBlock,
  parseUserSlug,
  type ArenaBlock,
} from "@/lib/arena";
import { requireAdminApi } from "@/lib/admin-api";

export const runtime = "nodejs";

const CHANNELS_PER_PAGE = 24;
const BLOCKS_PER_CHANNEL = 10;

type BlockOut = {
  id: number;
  title: string;
  type: string;
  position?: number;
  source_url?: string;
  content?: string;
  content_html?: string;
};

type ChannelOut = {
  id: number;
  slug: string;
  title: string;
  total: number;
  blocks: BlockOut[];
};

function blockTitle(b: ArenaBlock): string {
  if (typeof b.title === "string" && b.title.trim()) return b.title;
  if (b.generated_title && b.generated_title.trim()) return b.generated_title;
  return "Untitled";
}

function compareBlocks(a: BlockOut, b: BlockOut): number {
  const ap = a.position;
  const bp = b.position;
  if (ap === undefined && bp === undefined) return 0;
  if (ap === undefined) return 1;
  if (bp === undefined) return -1;
  return ap - bp;
}

export async function GET(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const userParam = url.searchParams.get("user");
  if (!userParam) {
    return NextResponse.json({ error: "Missing ?user=" }, { status: 400 });
  }

  let slug: string;
  try {
    slug = parseUserSlug(userParam);
  } catch (err) {
    if (err instanceof ArenaError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    throw err;
  }

  try {
    const [user, channelList] = await Promise.all([
      getUser(slug),
      getUserChannels(slug, { per: CHANNELS_PER_PAGE }),
    ]);

    const channels = channelList.data;
    const contents = await Promise.all(
      channels.map((c) =>
        getChannelContents(c.slug, { per: BLOCKS_PER_CHANNEL }).catch(
          (err: unknown) => {
            // Per-channel failure shouldn't kill the whole response. Log
            // server-side and emit an empty block list for that channel.
            console.error(
              `arena: getChannelContents(${c.slug}) failed:`,
              err instanceof Error ? err.message : err,
            );
            return null;
          },
        ),
      ),
    );

    const channelsOut: ChannelOut[] = channels.map((c, i) => {
      const items = contents[i]?.data ?? [];
      const blocks: BlockOut[] = items
        .filter(isArenaBlock)
        .map((b) => {
          const out: BlockOut = {
            id: b.id,
            title: blockTitle(b),
            type: String(b.type),
          };
          if (b.position !== undefined) out.position = b.position;
          const src =
            b.source?.url ??
            b.attachment?.url ??
            b.image?.src ??
            b.embed?.url ??
            undefined;
          if (src) out.source_url = src;
          const rich = b.content ?? b.description ?? null;
          if (rich) {
            const plain = rich.plain ?? rich.markdown ?? null;
            if (plain) out.content = plain;
            if (rich.html) out.content_html = rich.html;
          }
          return out;
        })
        .sort(compareBlocks);
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        total: c.counts?.contents ?? c.counts?.blocks ?? blocks.length,
        blocks,
      };
    });

    return NextResponse.json({
      user: {
        slug: user.slug,
        name: user.name,
        channel_count: user.counts?.channels,
      },
      channels: channelsOut,
      meta: {
        channels_shown: channelsOut.length,
        channels_total: channelList.meta.total_count,
      },
    });
  } catch (err) {
    if (err instanceof ArenaError) {
      return NextResponse.json(
        { error: err.message, status: err.status },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
