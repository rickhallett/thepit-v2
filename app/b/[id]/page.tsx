/**
 * /b/[id] — Short link redirect page.
 *
 * Resolves short link slug to bout ID and redirects to /bout/[boutId].
 * Task 25 will convert this into a full replay page.
 */

import { redirect, notFound } from "next/navigation";
import { resolveShortLink } from "@/lib/sharing/short-links";

export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boutId = await resolveShortLink(id);

  if (!boutId) {
    notFound();
  }

  redirect(`/bout/${boutId}`);
}
