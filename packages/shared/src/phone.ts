// Phone numbers, kept the way Prime ERP keeps them: the country code and the number as one run with no spaces,
// e.g. +201012345678. On a form the country code is chosen from the list (Egypt first) and the number is typed
// without the 0 in front. Taken from Prime ERP's production/api/src/rules/owners.ts.

const digitsOf = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** [country, code], Egypt first and then by name. */
export const DIAL: readonly (readonly [string, string])[] = (
  "Egypt 20|Afghanistan 93|Albania 355|Algeria 213|American Samoa 1684|Andorra 376|Angola 244|Anguilla 1264|Antigua and Barbuda 1268|Argentina 54|Armenia 374|Aruba 297|Australia 61|Austria 43|Azerbaijan 994|Bahamas 1242|Bahrain 973|Bangladesh 880|Barbados 1246|Belarus 375|Belgium 32|Belize 501|Benin 229|Bermuda 1441|Bhutan 975|Bolivia 591|Bosnia and Herzegovina 387|Botswana 267|Brazil 55|British Virgin Islands 1284|Brunei 673|Bulgaria 359|Burkina Faso 226|Burundi 257|Cambodia 855|Cameroon 237|Canada 1|Cape Verde 238|Cayman Islands 1345|Central African Republic 236|Chad 235|Chile 56|China 86|Colombia 57|Comoros 269|Congo (Brazzaville) 242|Congo (Kinshasa) 243|Cook Islands 682|Costa Rica 506|Côte d'Ivoire 225|Croatia 385|Cuba 53|Curaçao 599|Cyprus 357|Czechia 420|Denmark 45|Djibouti 253|Dominica 1767|Dominican Republic 1809|Ecuador 593|El Salvador 503|Equatorial Guinea 240|Eritrea 291|Estonia 372|Eswatini 268|Ethiopia 251|Falkland Islands 500|Faroe Islands 298|Fiji 679|Finland 358|France 33|French Guiana 594|French Polynesia 689|Gabon 241|Gambia 220|Georgia 995|Germany 49|Ghana 233|Gibraltar 350|Greece 30|Greenland 299|Grenada 1473|Guadeloupe 590|Guam 1671|Guatemala 502|Guinea 224|Guinea-Bissau 245|Guyana 592|Haiti 509|Honduras 504|Hong Kong 852|Hungary 36|Iceland 354|India 91|Indonesia 62|Iran 98|Iraq 964|Ireland 353|Israel 972|Italy 39|Jamaica 1876|Japan 81|Jordan 962|Kazakhstan 7|Kenya 254|Kiribati 686|Kosovo 383|Kuwait 965|Kyrgyzstan 996|Laos 856|Latvia 371|Lebanon 961|Lesotho 266|Liberia 231|Libya 218|Liechtenstein 423|Lithuania 370|Luxembourg 352|Macau 853|Madagascar 261|Malawi 265|Malaysia 60|Maldives 960|Mali 223|Malta 356|Marshall Islands 692|Martinique 596|Mauritania 222|Mauritius 230|Mayotte 262|Mexico 52|Micronesia 691|Moldova 373|Monaco 377|Mongolia 976|Montenegro 382|Montserrat 1664|Morocco 212|Mozambique 258|Myanmar 95|Namibia 264|Nauru 674|Nepal 977|Netherlands 31|New Caledonia 687|New Zealand 64|Nicaragua 505|Niger 227|Nigeria 234|Niue 683|Norfolk Island 672|North Korea 850|North Macedonia 389|Northern Mariana Islands 1670|Norway 47|Oman 968|Pakistan 92|Palau 680|Palestine 970|Panama 507|Papua New Guinea 675|Paraguay 595|Peru 51|Philippines 63|Poland 48|Portugal 351|Puerto Rico 1787|Qatar 974|Réunion 262|Romania 40|Russia 7|Rwanda 250|Saint Helena 290|Saint Kitts and Nevis 1869|Saint Lucia 1758|Saint Pierre and Miquelon 508|Saint Vincent and the Grenadines 1784|Samoa 685|San Marino 378|São Tomé and Príncipe 239|Saudi Arabia 966|Senegal 221|Serbia 381|Seychelles 248|Sierra Leone 232|Singapore 65|Sint Maarten 1721|Slovakia 421|Slovenia 386|Solomon Islands 677|Somalia 252|South Africa 27|South Korea 82|South Sudan 211|Spain 34|Sri Lanka 94|Sudan 249|Suriname 597|Sweden 46|Switzerland 41|Syria 963|Taiwan 886|Tajikistan 992|Tanzania 255|Thailand 66|Timor-Leste 670|Togo 228|Tokelau 690|Tonga 676|Trinidad and Tobago 1868|Tunisia 216|Turkey 90|Turkmenistan 993|Turks and Caicos Islands 1649|Tuvalu 688|Uganda 256|Ukraine 380|United Arab Emirates 971|United Kingdom 44|United States 1|Uruguay 598|US Virgin Islands 1340|Uzbekistan 998|Vanuatu 678|Vatican City 39|Venezuela 58|Vietnam 84|Wallis and Futuna 681|Yemen 967|Zambia 260|Zimbabwe 263"
)
  .split('|')
  .map((x) => {
    const i = x.lastIndexOf(' ');
    return [x.slice(0, i), x.slice(i + 1)] as const;
  });

/** Of the countries that share a code, the one a number on file is shown under. */
export const DIAL_FIRST: Readonly<Record<string, string>> = { 1: 'United States', 7: 'Russia', 39: 'Italy', 262: 'Réunion' };

/** The longest first: 1242 is the Bahamas, not the United States. */
const DIAL_CODES = [...new Set(DIAL.map((x) => x[1]))].sort((a, b) => b.length - a.length);

/** Italy dials the 0 of its numbers from abroad as well. */
const DIAL_KEEPS_0 = ['39'];

const dialNumber = (code: string, digits: string) => (DIAL_KEEPS_0.includes(code) ? digits : digits.replace(/^0+/, ''));

/**
 * A number as it is kept (+201012345678), from however it was written: an Egyptian number as it is dialled
 * (010 1234 5678), or with its country code (+20 …, 0020 …). Empty when there are no digits.
 */
export function phoneTidy(v: unknown): string {
  const t = String(v ?? '').trim();
  const abroad = /^(\+|00)/.test(t);
  let d = digitsOf(t);
  if (!d) return '';
  if (!abroad) {
    d = dialNumber('20', d);
    return d ? `+20${d}` : '';
  }
  if (/^00/.test(t)) d = d.slice(2);
  const code = DIAL_CODES.find((c) => d.startsWith(c));
  if (!code) return `+${d}`;
  const n = dialNumber(code, d.slice(code.length));
  return n ? `+${code}${n}` : '';
}

/** From the two parts of a form: the country code chosen and the number typed. A whole number pasted with its code is taken as it is. */
export function phoneJoin(code: unknown, number: unknown): string {
  const t = String(number ?? '').trim();
  if (!t) return '';
  if (/^(\+|00)/.test(t)) return phoneTidy(t);
  const cc = digitsOf(code) || '20';
  const n = dialNumber(cc, digitsOf(t));
  return n ? `+${cc}${n}` : '';
}

/** The two parts of a number on file, for a form: the country code (Egypt when empty) and the number. */
export function phoneSplit(v: unknown): { cc: string; n: string } {
  const t = phoneTidy(v);
  if (!t) return { cc: '20', n: '' };
  const d = t.slice(1);
  const cc = DIAL_CODES.find((c) => d.startsWith(c)) ?? '';
  return { cc, n: d.slice(cc.length) };
}

/** A number that can be dialled: a known country code and a plausible length. In Egypt a mobile has 10 digits and a landline 8 or 9. */
export function phoneOk(v: string): boolean {
  const p = /^\+\d{8,15}$/.test(v) ? phoneSplit(v) : null;
  return !!p && !!p.cc && p.n.length >= 4 && (p.cc !== '20' || (p.n.length >= 8 && p.n.length <= 10));
}
