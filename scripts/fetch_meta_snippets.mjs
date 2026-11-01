async function fetchDocSnippets(path) {
  const url = `https://dev.meta.ai${path}?team_id=28802630929372428&project_id=2962006444143464`;
  const res = await fetch(url);
  const html = await res.text();
  // Extract curl, python or json code blocks
  console.log(`\n================== CODE BLOCKS IN ${path} ==================`);
  const matches = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];
  for (const m of matches.slice(0, 6)) {
    const clean = m.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
    console.log('--- BLOCK ---');
    console.log(clean);
  }
}

async function main() {
  await fetchDocSnippets('/docs/video-understanding');
  await fetchDocSnippets('/docs/media-segmentation');
  await fetchDocSnippets('/docs/sam/segmenting');
  await fetchDocSnippets('/docs/api-reference/images/edit-image');
}
main();
