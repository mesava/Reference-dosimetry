// Проверка двуязычности: находит русские строки в JS, у которых нет английской пары.
// Пара записывается как L('по-русски', 'in English'). Допускаются: ссылки на источники
// (объекты REF и аргумент ref, их переводит refText), справки terms.js (перевод в terms-en.js),
// словарь статического текста и демонстрационные данные.
// Запуск: node scripts/i18n-check.mjs [--all]  — выводит строки без пары; код выхода 1, если они есть.
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'acorn';
import { ancestor } from 'acorn-walk';

const CYR = /[А-Яа-яЁё]/;
const SKIP_FILES = new Set(['src/ui/terms.js', 'src/ui/terms-en.js', 'src/ui/i18n-static-en.js', 'src/core/sample.js', 'src/core/sample-cobalt.js', 'src/core/sample-electrons.js', 'src/core/sample-crosscal.js', 'src/core/sample-uncertainty.js', 'src/core/i18n.js']);
const files = ['src/core', 'src/ui'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`)).filter((f) => !SKIP_FILES.has(f));

const isL = (n) => n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'L';
const text = (n) => (n.type === 'Literal' ? String(n.value) : n.quasis.map((q) => q.value.cooked).join('${…}'));

let total = 0;
const report = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const bad = [];
  const visit = (node, anc) => {
    const s = text(node);
    if (!CYR.test(s)) return;
    // внутри L(ru, en): разрешено, если узел — первый или второй аргумент (или вложен в них)
    for (let i = anc.length - 2; i >= 0; i--) {
      const a = anc[i];
      if (isL(a)) {
        const child = anc[i + 1];
        if (a.arguments.indexOf(child) === 0 && a.arguments.length >= 2) return;
        if (a.arguments.indexOf(child) === 1) return;
      }
      // REF = { … } и свойства ref/refs — переводятся refText()
      if (a.type === 'VariableDeclarator' && a.id.name === 'REF') return;
      if (a.type === 'Property' && ['ref', 'refs'].includes(a.key?.name)) return;
      // import/export, ключи объектов-словарей
      if (a.type === 'ImportDeclaration' || a.type === 'ExportAllDeclaration') return;
      // свойство с английским двойником: note/noteEn, text/textEn, label/labelEn, { ru, en }
      if (a.type === 'Property' && anc[i + 1] === a.value && a.key?.name) {
        const obj = anc[i - 1];
        if (obj?.type === 'ObjectExpression' && obj.properties.some((p) => p.key?.name === `${a.key.name}En`)) return;
        if (obj?.type === 'ObjectExpression' && a.key.name === 'ru' && obj.properties.some((p) => p.key?.name === 'en')) return;
      }
    }
    // ссылка на источник целиком: «TRS-398 Rev.1, разд. 4.4.3.1; аддендум TG-51 (2014), разд. 5.A.6»
    if (/^(TRS-398|аддендум TG-51|TG-51|WGTG51|Report|\$\{…\})[^.]*?(разд\.|табл\.|ур\.|прил\.)/.test(s) && s.length < 160 && !/[а-яё]{4,} [а-яё]{4,} [а-яё]{4,}/i.test(s.replace(/аддендум TG-51|рабочая запись|рабочий лист/g, ''))) return;
    // ссылки на источники: шаблоны и строки с «разд.», «табл.», «ур.» вида `${REF.x}, разд. 4`
    if (/^(\$\{…\})?,? ?(разд\.|табл\.|ур\.|прил\.|сноска|рабочая запись|рабочий лист)/.test(s) || /^\$\{…\}, (разд|табл|ур|прил)\./.test(s)) return;
    bad.push(`${file}:${node.loc.start.line}: ${s.slice(0, 110).replace(/\n/g, ' ')}`);
  };
  ancestor(ast, { Literal: (n, anc) => typeof n.value === 'string' && visit(n, anc), TemplateLiteral: (n, anc) => visit(n, anc) });
  total += bad.length;
  if (bad.length) report.push(`--- ${file}: ${bad.length}`, ...(process.argv.includes('--all') ? bad : bad.slice(0, 8)));
}
console.log(report.join('\n'));
console.log(`Без английской пары: ${total}`);
process.exit(total ? 1 : 0);
