import { fieldKeyword, unwrapFields } from './fields.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const part = (body: string) => `<w:document ${W}><w:body>${body}</w:body></w:document>`;
const unwrap = (body: string) => {
  const out = unwrapFields(part(body));
  return out.slice(part('').indexOf('<w:body>') + 8, out.lastIndexOf('</w:body>'));
};

const begin = '<w:fldChar w:fldCharType="begin"/>';
const separate = '<w:fldChar w:fldCharType="separate"/>';
const end = '<w:fldChar w:fldCharType="end"/>';
const run = (inner: string, props = '') => `<w:r>${props}${inner}</w:r>`;
const instr = (text: string) => `<w:instrText xml:space="preserve">${text}</w:instrText>`;
const t = (text: string) => `<w:t>${text}</w:t>`;
/** A complex field, one run per piece. */
const field = (instruction: string, ...result: string[]) => run(begin) + run(instr(instruction)) + run(separate) + result.join('') + run(end);

describe('unwrapping Word fields', () => {
  it("keeps only a MERGEFIELD's result, as the owner's contract writes it (instruction and separator sharing runs)", () => {
    const rtl = '<w:rPr><w:rtl/></w:rPr>';
    const body =
      '<w:p>' +
      run('<w:t xml:space="preserve">إنه في يوم </w:t>') +
      run(begin + instr(' '), rtl) +
      run('<w:instrText>MERGEFIELD</w:instrText>', rtl) +
      run(instr(' اليوم'), rtl) +
      run(instr(' ') + separate, rtl) +
      run(t('{{day_name}}'), '<w:rPr><w:noProof/><w:rtl/></w:rPr>') +
      run(end, rtl) +
      '</w:p>';
    expect(unwrap(body)).toBe('<w:p>' + run('<w:t xml:space="preserve">إنه في يوم </w:t>') + run(t('{{day_name}}'), '<w:rPr><w:noProof/><w:rtl/></w:rPr>') + '</w:p>');
  });

  it('takes the field characters out of a run that also holds result text', () => {
    const body = '<w:p>' + run(begin) + run(instr(' DATE \\@ "d/M/yyyy" ')) + run(separate + t('15/10/2026') + end, '<w:rPr><w:b/></w:rPr>') + '</w:p>';
    expect(unwrap(body)).toBe('<w:p>' + run(t('15/10/2026'), '<w:rPr><w:b/></w:rPr>') + '</w:p>');
  });

  it('keeps page numbers live, and unwraps the other fields next to them', () => {
    const footer =
      '<w:p>' +
      run(t('Page ')) +
      field(' PAGE \\* MERGEFORMAT ', run(t('1'))) +
      run(t(' of ')) +
      '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>3</w:t></w:r></w:fldSimple>' +
      field(' SECTIONPAGES ', run(t('3'))) +
      run(t(' · ')) +
      field(' DATE ', run(t('14/10/2026'))) +
      '</w:p>';
    expect(unwrap(footer)).toBe(footer.replace(field(' DATE ', run(t('14/10/2026'))), run(t('14/10/2026'))));
  });

  it('unwraps simple fields to their runs, and drops one with no result', () => {
    const body =
      '<w:p>' +
      '<w:fldSimple w:instr=" MERGEFIELD الأسم "><w:r><w:rPr><w:b/></w:rPr><w:t>{{full_name_ar}}</w:t></w:r></w:fldSimple>' +
      '<w:fldSimple w:instr=" XE &quot;عقد&quot; "/>' +
      '<w:fldSimple w:instr=" AUTHOR "><w:fldData>AAAA</w:fldData><w:r><w:t>HR</w:t></w:r></w:fldSimple>' +
      '</w:p>';
    expect(unwrap(body)).toBe('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{full_name_ar}}</w:t></w:r><w:r><w:t>HR</w:t></w:r></w:p>');
  });

  it('drops a field nested in an instruction with it, page numbers too', () => {
    const body =
      '<w:p>' +
      run(begin) +
      run(instr(' IF ')) +
      field(' MERGEFIELD Gender ', run(t('M'))) +
      run(instr(' = "M" "السيد" "السيدة" ')) +
      field(' PAGE ', run(t('1'))) +
      run(separate) +
      run(t('السيد')) +
      run(end) +
      '</w:p>';
    expect(unwrap(body)).toBe('<w:p>' + run(t('السيد')) + '</w:p>');
  });

  it('unwraps a field nested in a result as well', () => {
    const body = '<w:p>' + field(' HYPERLINK "https://trendlix.com" ', run(t('see ')), field(' REF _Ref1 \\h ', run(t('clause 4'))), run(t('.'))) + '</w:p>';
    expect(unwrap(body)).toBe('<w:p>' + run(t('see ')) + run(t('clause 4')) + run(t('.')) + '</w:p>');
  });

  it('drops a field with no result', () => {
    expect(unwrap('<w:p>' + run(t('a')) + run(begin) + run(instr(' TC "x" ')) + run(end) + run(t('b')) + '</w:p>')).toBe('<w:p>' + run(t('a')) + run(t('b')) + '</w:p>');
  });

  it('keeps paragraphs and bookmarks a field spans', () => {
    const body =
      '<w:p>' +
      run(begin) +
      '<w:bookmarkStart w:id="1" w:name="x"/>' +
      run(instr(' TOC \\o "1-3" ')) +
      run(separate) +
      run(t('One')) +
      '</w:p><w:p>' +
      run(t('Two')) +
      '<w:bookmarkEnd w:id="1"/>' +
      run(end) +
      '</w:p>';
    expect(unwrap(body)).toBe('<w:p><w:bookmarkStart w:id="1" w:name="x"/>' + run(t('One')) + '</w:p><w:p>' + run(t('Two')) + '<w:bookmarkEnd w:id="1"/></w:p>');
  });

  it("unwraps a text box's fields on their own", () => {
    const box = (inner: string) => run(`<w:drawing><w:txbxContent><w:p>${inner}</w:p></w:txbxContent></w:drawing>`);
    const body = '<w:p>' + run(begin) + run(instr(' MERGEFIELD a ')) + run(separate) + box(field(' MERGEFIELD b ', run(t('B')))) + run(t('A')) + run(end) + '</w:p>';
    expect(unwrap(body)).toBe('<w:p>' + box(run(t('B'))) + run(t('A')) + '</w:p>');
  });

  it('leaves a field cut short, and a stray end, alone', () => {
    const cut = '<w:p>' + run(begin) + run(instr(' MERGEFIELD a ')) + run(separate) + run(t('A')) + '</w:p>';
    expect(unwrap(cut)).toBe(cut);
    const stray = '<w:p>' + run(t('A')) + run(end) + '</w:p>';
    expect(unwrap(stray)).toBe(stray);
  });

  it('leaves a part without fields as it is', () => {
    const body = '<w:p>' + run(t('{{full_name_ar}}')) + '</w:p>';
    expect(unwrapFields(part(body))).toBe(part(body));
  });

  it("reads a field's keyword", () => {
    expect(fieldKeyword(' page  \\* MERGEFORMAT ')).toBe('PAGE');
    expect(fieldKeyword('MERGEFIELD الأسم')).toBe('MERGEFIELD');
    expect(fieldKeyword('   ')).toBe('');
  });
});
