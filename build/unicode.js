const fs = require('fs');
const path = require('path');
const regenerate = require('regenerate');

const Space_Separator = regenerate()
  .add(require('unicode-10.0.0/General_Category/Space_Separator/code-points'))
  .remove('\t', '\v', '\f', ' ', '\u00A0', '\uFEFF');

const ID_Start = regenerate()
  .add(require('unicode-10.0.0/General_Category/Uppercase_Letter/code-points'))
  .add(require('unicode-10.0.0/General_Category/Lowercase_Letter/code-points'))
  .add(require('unicode-10.0.0/General_Category/Titlecase_Letter/code-points'))
  .add(require('unicode-10.0.0/General_Category/Modifier_Letter/code-points'))
  .add(require('unicode-10.0.0/General_Category/Other_Letter/code-points'))
  .add(require('unicode-10.0.0/General_Category/Letter_Number/code-points'))
  .remove('$', '_')
  .removeRange('A', 'Z')
  .removeRange('a', 'z');

const ID_Continue = regenerate()
  .add(ID_Start)
  .add(require('unicode-10.0.0/General_Category/Nonspacing_Mark/code-points'))
  .add(require('unicode-10.0.0/General_Category/Spacing_Mark/code-points'))
  .add(require('unicode-10.0.0/General_Category/Decimal_Number/code-points'))
  .add(require('unicode-10.0.0/General_Category/Connector_Punctuation/code-points'))
  .remove('$', '_')
  .removeRange('0', '9')
  .removeRange('A', 'Z')
  .removeRange('a', 'z');

const outPath = path.resolve('./src/unicode.ts');

const data = {
  Space_Separator,
  ID_Start,
  ID_Continue,
};

const output = [
  '// This is a generated file. Do not edit.',
  ...Object.keys(data).map(key => `export const ${key} = /${data[key]}/;`),
  `export default { ${Object.keys(data).join(', ')} };`,
].join('\n') + '\n';

fs.writeFileSync(outPath, output);
