async function main() {
  const res = await fetch('https://dev.meta.ai/docs/overview?team_id=28802630929372428&project_id=2962006444143464');
  const html = await res.text();
  const links = new Set();
  const re = /href=["'](\/docs\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) links.add(m[1]);
  console.log(Array.from(links).sort().join('\n'));
}
main();
