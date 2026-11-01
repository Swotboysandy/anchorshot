async function fetchDoc(path) {
  const url = `https://dev.meta.ai${path}?team_id=28802630929372428&project_id=2962006444143464`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                     .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
    console.log(`\n================== ${path} ==================`);
    console.log(text.slice(0, 3000));
  } catch (err) {
    console.error(`Error fetching ${path}:`, err);
  }
}

async function main() {
  await fetchDoc('/docs/video-understanding');
  await fetchDoc('/docs/media-segmentation');
  await fetchDoc('/docs/sam/segmenting');
  await fetchDoc('/docs/sam/reading-segmentation');
  await fetchDoc('/docs/api-reference/images/edit-image');
  await fetchDoc('/docs/api-reference/voice/realtime');
}
main();
