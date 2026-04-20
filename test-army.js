const op = "UNITED STATES ARMY";
const kws = ["US ARMY", "USARMY", "AIR FORCE", "USAF"];
for (const kw of kws) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|[^A-Z])' + escaped + '(?:[^A-Z]|$)');
  console.log(kw, '→', re.test(op), '(regex:', re.source, ')');
}
console.log('Direct includes:', kws.filter(k => op.includes(k)));
