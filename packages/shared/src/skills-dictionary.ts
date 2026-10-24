// The skills the rules look for in every CV (owner, 24 October 2026: "is the pulled data all what can be pulled from the
// uploaded cv?"; chose "CV years in list + more rules", still no AI): the agency's and the office's tools and crafts, in
// a file of their own so HR can later edit them. Each is found as cvSkillsFound finds a vacancy's key skills (whole
// words, any case and punctuation, Arabic too: cv-analysis.ts cvSkillsIn), under its name or any of its other names; the
// common soft skills (communication, teamwork …) are left out, as every CV names them.
// - `aliases`: other ways CVs write it ("Adobe Premiere", "بريمير").
// - `loose`: a word too common to count alone ("Word"), found only on a line that also names one of `looseWith`
//   ("MS Office: Word, Excel, PowerPoint").

export const SKILL_GROUPS = ['video', 'design', 'marketing', 'office', 'content', 'development', 'finance'] as const;
export type SkillGroup = (typeof SKILL_GROUPS)[number];

export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = {
  video: 'Video',
  design: 'Design',
  marketing: 'Marketing',
  office: 'Office',
  content: 'Content',
  development: 'Development',
  finance: 'Finance',
};

export interface DictionarySkill {
  /** The skill as the system shows it, and as the lists filter by it. */
  name: string;
  group: SkillGroup;
  aliases?: readonly string[];
  loose?: readonly string[];
  looseWith?: readonly string[];
}

export const SKILLS_DICTIONARY: readonly DictionarySkill[] = [
  // video
  { name: 'Premiere Pro', group: 'video', aliases: ['Adobe Premiere', 'Premiere CC', 'بريمير'] },
  { name: 'After Effects', group: 'video', aliases: ['AfterEffects', 'أفتر إفكتس', 'أفتر إفيكتس'] },
  { name: 'DaVinci Resolve', group: 'video', aliases: ['DaVinci', 'Da Vinci Resolve', 'دافنشي'] },
  { name: 'Final Cut Pro', group: 'video', aliases: ['Final Cut', 'FCPX', 'FCP X', 'فاينل كات'] },
  { name: 'Cinema 4D', group: 'video', aliases: ['C4D', 'Cinema4D'] },
  { name: 'Blender', group: 'video', aliases: ['بلندر'] },
  // design
  { name: 'Photoshop', group: 'design', aliases: ['فوتوشوب'] },
  { name: 'Illustrator', group: 'design', aliases: ['إليستريتور', 'الستريتور'] },
  { name: 'InDesign', group: 'design', aliases: ['In Design', 'إن ديزاين'] },
  { name: 'Figma', group: 'design', aliases: ['فيجما'] },
  { name: 'Canva', group: 'design', aliases: ['كانفا'] },
  // marketing
  { name: 'Meta Ads', group: 'marketing', aliases: ['Facebook Ads', 'Meta Ads Manager', 'Facebook Ads Manager', 'Meta Business Suite'] },
  { name: 'Google Ads', group: 'marketing', aliases: ['Google AdWords', 'AdWords'] },
  { name: 'Google Analytics', group: 'marketing', aliases: ['GA4'] },
  { name: 'SEO', group: 'marketing', aliases: ['Search Engine Optimization', 'Search Engine Optimisation'] },
  { name: 'SEM', group: 'marketing', aliases: ['Search Engine Marketing'] },
  { name: 'TikTok Ads', group: 'marketing', aliases: ['Tik Tok Ads', 'TikTok Ads Manager'] },
  { name: 'HubSpot', group: 'marketing', aliases: ['Hub Spot'] },
  { name: 'Mailchimp', group: 'marketing', aliases: ['Mail Chimp'] },
  // office
  { name: 'Excel', group: 'office', aliases: ['MS Excel', 'Microsoft Excel', 'إكسل', 'الإكسل'] },
  { name: 'PowerPoint', group: 'office', aliases: ['Power Point', 'MS PowerPoint', 'باوربوينت', 'بوربوينت'] },
  { name: 'Word', group: 'office', aliases: ['MS Word', 'Microsoft Word', 'وورد'], loose: ['Word'], looseWith: ['Excel', 'PowerPoint', 'Power Point', 'Outlook', 'MS Office', 'Microsoft Office'] },
  // content
  { name: 'Copywriting', group: 'content', aliases: ['Copy Writing', 'كتابة الإعلانات'] },
  { name: 'Content writing', group: 'content', aliases: ['كتابة المحتوى'] },
  { name: 'Social media management', group: 'content', aliases: ['Social Media Marketing', 'Managing Social Media', 'SMM', 'إدارة السوشيال ميديا'] },
  { name: 'Photography', group: 'content', aliases: ['التصوير الفوتوغرافي'] },
  { name: 'Videography', group: 'content', aliases: ['Video Shooting', 'تصوير الفيديو'] },
  { name: 'Motion graphics', group: 'content', aliases: ['Motion Graphic', 'Motion Design', 'موشن جرافيك'] },
  { name: '3D', group: 'content', aliases: ['3D Modeling', '3D Modelling', '3D Animation', '3D Design'] },
  { name: 'UI/UX', group: 'content', aliases: ['UX/UI', 'UI UX', 'UI Design', 'UX Design', 'User Experience'] },
  // development
  { name: 'HTML', group: 'development', aliases: ['HTML5'] },
  { name: 'CSS', group: 'development', aliases: ['CSS3'] },
  { name: 'JavaScript', group: 'development', aliases: ['Java Script'] },
  { name: 'React', group: 'development', aliases: ['React.js', 'ReactJS', 'React JS'] },
  { name: 'WordPress', group: 'development', aliases: ['Word Press', 'ووردبريس'] },
  { name: 'Python', group: 'development', aliases: ['بايثون'] },
  { name: 'SQL', group: 'development', aliases: ['MySQL', 'PostgreSQL', 'MS SQL'] },
  // finance
  { name: 'Odoo', group: 'finance', aliases: ['أودو'] },
  { name: 'SAP', group: 'finance' },
  { name: 'QuickBooks', group: 'finance', aliases: ['Quick Books'] },
];

/** The dictionary's skills by name, in its order: the lists' "Skill" filter. */
export const DICTIONARY_SKILL_NAMES: readonly string[] = SKILLS_DICTIONARY.map((s) => s.name);

/** Whether a name is one of the dictionary's skills (as written there). */
export const isDictionarySkill = (name: unknown): name is string => typeof name === 'string' && DICTIONARY_SKILL_NAMES.includes(name);
