/* ECMAScript identifier + space-separator character classes.
 *
 * ID_Start / ID_Continue use ES2018 RegExp Unicode property escapes, so they
 * track the JavaScript engine's current Unicode version automatically (no
 * generated tables, no build step). Characters are tested as full code points
 * (the parser reads via String.fromCodePoint), so astral identifiers match.
 *
 * Space_Separator is the General_Category Zs set minus the ASCII space and
 * U+00A0, both of which the lexer handles as explicit cases.
 */
export const Space_Separator = /[\u1680\u2000-\u200A\u202F\u205F\u3000]/;
export const ID_Start = /\p{ID_Start}/u;
export const ID_Continue = /\p{ID_Continue}/u;

export default { Space_Separator, ID_Start, ID_Continue };
