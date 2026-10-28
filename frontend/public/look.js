// The season's colors worn last time (lib/seasons.ts keeps them), so the first paint is not a flash of
// other ones.
try {
  var saved = JSON.parse(localStorage.getItem('alacarte-look') || 'null')
  if (saved && saved.vars) for (var k in saved.vars) document.documentElement.style.setProperty(k, saved.vars[k])
} catch (e) {}
