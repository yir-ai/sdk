import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('spec/account-openapi.json', root), 'utf8'));
const schemas = spec.components.schemas;
const name = ref => 'Account' + ref.split('/').at(-1).split('.').at(-1).replace(/^YIR/, '');
const field = key => key.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('');
function type(s, lang) {
  if (s.$ref) return name(s.$ref);
  if (s.allOf) return lang === 'ts' ? s.allOf.map(v => type(v, lang)).join(' & ') : 'map[string]any';
  if (s.enum && lang === 'ts') return s.enum.map(v => JSON.stringify(v)).join(' | ');
  if (s.type === 'array') return lang === 'ts' ? `Array<${type(s.items, lang)}>` : `[]${type(s.items, lang)}`;
  if (s.type === 'string') return 'string';
  if (s.type === 'boolean') return lang === 'ts' ? 'boolean' : 'bool';
  if (s.type === 'integer' || s.type === 'number') return lang === 'ts' ? 'number' : s.type === 'integer' ? 'int64' : 'float64';
  if (s.properties) {
    return (lang === 'ts' ? '{\n' : 'struct {\n') + Object.entries(s.properties).map(([k,v]) => {
      const required = (s.required ?? []).includes(k);
      const t = type(v, lang);
      if (lang === 'ts') return `  ${JSON.stringify(k)}${required ? '' : '?'}: ${t};`;
      // Optional collections need pointers too: omitted means unchanged, [] clears a patch field.
      const ptr = !required && t !== 'any' ? '*' : '';
      return `  ${field(k)} ${ptr}${t} \x60json:"${k}${required ? '' : ',omitempty'}"\x60`;
    }).join('\n') + '\n}';
  }
  if (s.type === 'object' || s.additionalProperties) return lang === 'ts' ? 'Record<string, unknown>' : 'map[string]any';
  return lang === 'ts' ? 'unknown' : 'any';
}
for (const [lang, file] of [['ts','typescript/src/shared/account-types.ts'], ['go','go/account_types.go']]) {
  let text = '// Generated from spec/account-openapi.json. Do not edit.\n' + (lang === 'go' ? 'package yir\n\n' : '');
  for (const [key,s] of Object.entries(schemas)) text += lang === 'ts'
    ? `export type ${name(key)} = ${type(s,lang)};\n\n`
    : `type ${name(key)} ${type(s,lang)}\n\n`;
  const target = new URL(file, root);
  if (process.argv.includes('--check')) {
    const actual = readFileSync(target, 'utf8');
    // gofmt only changes whitespace in these generated declarations.
    const comparable = value => lang === 'go' ? value.replace(/\s/g, '') : value;
    if (comparable(actual) !== comparable(text)) throw new Error(`Stale Account API types: ${file}`);
  } else writeFileSync(target, text);
}
