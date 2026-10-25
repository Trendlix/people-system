import {
  CV_POSITION_LIMITS,
  cvPositions,
  normalPositionName,
  OTHER_POSITION,
  positionChoiceProblems,
  positionGroups,
  positionKeyOf,
  positionNameOf,
  teamIdOfKey,
  type PositionTeam,
  type PositionTitle,
} from '@trendlix/shared';

// The positions on "Send us your CV" (owner, 25 October 2026, on General CVs' "Area" filter: "what do you mean by area
// here?", then "should it be the positions?"; asked, "Position, grouped by team"; packages/shared cv-positions.ts): the
// job titles with their levels merged, never C-level, grouped by team, each keyed by its team and its name, HR's choices
// (hidden, a public name) by key. Every team and title here is made up.

describe('a job title’s position name: its levels merged', () => {
  it('takes off the level words before it: "Junior Video Editor" and "Senior Video Editor" are "Video Editor"', () => {
    expect(positionNameOf('Junior Video Editor')).toBe('Video Editor');
    expect(positionNameOf('Senior Video Editor')).toBe('Video Editor');
    expect(positionNameOf('Lead Video Editor')).toBe('Video Editor');
    expect(positionNameOf('Principal Designer')).toBe('Designer');
    expect(positionNameOf('Associate Producer')).toBe('Producer');
    expect(positionNameOf('Assistant Producer')).toBe('Producer');
    expect(positionNameOf('Intern Copywriter')).toBe('Copywriter');
    expect(positionNameOf('Trainee Accountant')).toBe('Accountant');
    expect(positionNameOf('Sr. Graphic Designer')).toBe('Graphic Designer');
    expect(positionNameOf('Jr Graphic Designer')).toBe('Graphic Designer');
    expect(positionNameOf('Mid-level Developer')).toBe('Developer');
    expect(positionNameOf('Entry level Developer')).toBe('Developer');
    // several at once, and the spaces made single
    expect(positionNameOf('  Senior   Lead  Video Editor ')).toBe('Video Editor');
  });

  it('takes off the level words after it, and a level in brackets or after a dash', () => {
    expect(positionNameOf('Video Editor II')).toBe('Video Editor');
    expect(positionNameOf('Software Engineer III')).toBe('Software Engineer');
    expect(positionNameOf('Graphic Designer I')).toBe('Graphic Designer');
    expect(positionNameOf('Video Editor Sr.')).toBe('Video Editor');
    expect(positionNameOf('Video Editor (Senior)')).toBe('Video Editor');
    expect(positionNameOf('Video Editor - Junior')).toBe('Video Editor');
    expect(positionNameOf('Video Editor, Intern')).toBe('Video Editor');
    expect(positionNameOf('Video Editor – Lead')).toBe('Video Editor');
    // Intern and Trainee after a word naming a person
    expect(positionNameOf('Video Editor Intern')).toBe('Video Editor');
    expect(positionNameOf('Developer Trainee')).toBe('Developer');
  });

  it('keeps the words that change the job: Head of, Manager, a team’s lead, an assistant’s job, an intern of a field', () => {
    expect(positionNameOf('Head of Content')).toBe('Head of Content');
    expect(positionNameOf('Senior Head of Content')).toBe('Head of Content');
    expect(positionNameOf('Account Manager')).toBe('Account Manager');
    expect(positionNameOf('Senior Account Manager')).toBe('Account Manager');
    expect(positionNameOf('Team Lead')).toBe('Team Lead');
    expect(positionNameOf('Design Lead')).toBe('Design Lead');
    expect(positionNameOf('Executive Assistant')).toBe('Executive Assistant');
    expect(positionNameOf('Sales Associate')).toBe('Sales Associate');
    expect(positionNameOf('Marketing Intern')).toBe('Marketing Intern');
    expect(positionNameOf('Management Trainee')).toBe('Management Trainee');
    expect(positionNameOf('Content Intern')).toBe('Content Intern');
    expect(positionNameOf('Lead Generation Specialist')).toBe('Lead Generation Specialist');
    expect(positionNameOf('Assistant to the CEO')).toBe('Assistant to the CEO');
    expect(positionNameOf('Front-End Developer')).toBe('Front-End Developer');
  });

  it('never down to nothing', () => {
    expect(positionNameOf('Intern')).toBe('Intern');
    expect(positionNameOf('Senior')).toBe('Senior');
    expect(positionNameOf('Senior Associate')).toBe('Associate');
    expect(positionNameOf('(Senior)')).toBe('(Senior)');
    expect(positionNameOf('   ')).toBe('');
  });

  it('in Arabic too: أول, مبتدئ, متدرب, رئيسي after; متدرب, مساعد before', () => {
    expect(positionNameOf('محرر فيديو أول')).toBe('محرر فيديو');
    expect(positionNameOf('محرر فيديو مبتدئ')).toBe('محرر فيديو');
    expect(positionNameOf('محاسب متدرب')).toBe('محاسب');
    expect(positionNameOf('مصمم رئيسي')).toBe('مصمم');
    expect(positionNameOf('متدرب تسويق رقمي')).toBe('تسويق رقمي');
    expect(positionNameOf('مساعد مدير التسويق')).toBe('مدير التسويق');
    expect(positionNameOf('رئيس قسم المحتوى')).toBe('رئيس قسم المحتوى');
    // compared alike with and without the hamza and the marks
    expect(normalPositionName('محرّر فيديو')).toBe(normalPositionName('محرر فيديو'));
    expect(normalPositionName('إدارة')).toBe(normalPositionName('ادارة'));
  });
});

describe('the keys', () => {
  it('a team’s id and the name as compared: the level, the case and the spaces never change it', () => {
    expect(positionKeyOf('team-video', 'Video Editor')).toBe('team-video:video editor');
    expect(positionKeyOf('team-video', positionNameOf('Senior  VIDEO editor'))).toBe('team-video:video editor');
    expect(teamIdOfKey('team-video:video editor')).toBe('team-video');
    expect(teamIdOfKey(OTHER_POSITION)).toBeNull();
    expect(teamIdOfKey(':video editor')).toBeNull();
  });
});

describe('the positions, grouped by team', () => {
  // the organisation's order: a department, then its teams
  const TEAMS: PositionTeam[] = [
    { id: 'production', name: 'Production', departmentName: null },
    { id: 'video', name: 'Video', departmentName: 'Production' },
    { id: 'content-prod', name: 'Content', departmentName: 'Production' },
    { id: 'marketing', name: 'Marketing', departmentName: null },
    { id: 'content-mkt', name: 'Content', departmentName: 'Marketing' },
    { id: 'board', name: 'Board', departmentName: null },
    { id: 'empty', name: 'Empty', departmentName: 'Marketing' },
  ];
  const title = (id: string, name: string, teamId: string, cLevel = false): PositionTitle => ({ id, name, teamId, cLevel });
  const TITLES: PositionTitle[] = [
    title('t1', 'Junior Video Editor', 'video'),
    title('t2', 'Senior Video Editor', 'video'),
    title('t3', 'Motion Designer', 'video'),
    title('t4', 'Head of Production', 'production'),
    title('t5', 'Copywriter', 'content-prod'),
    title('t6', 'Copywriter', 'content-mkt'),
    title('t7', 'Head of Content', 'content-mkt'),
    title('t8', 'Chief Executive Officer', 'board', true),
    title('t9', 'Senior Copywriter', 'content-mkt'),
    // a team not on the list: left out
    title('t10', 'Ghost Writer', 'gone'),
  ];

  it('merges each team’s levels into one position, keeping its team and the job titles it merges', () => {
    const video = cvPositions(TEAMS, TITLES).filter((p) => p.teamId === 'video');
    expect(video).toEqual([
      { key: 'video:motion designer', name: 'Motion Designer', publicName: null, shownName: 'Motion Designer', hidden: false, teamId: 'video', team: 'Video', teamHrName: 'Video · Production', titleIds: ['t3'], titles: ['Motion Designer'] },
      {
        key: 'video:video editor',
        name: 'Video Editor',
        publicName: null,
        shownName: 'Video Editor',
        hidden: false,
        teamId: 'video',
        team: 'Video',
        teamHrName: 'Video · Production',
        titleIds: ['t1', 't2'],
        titles: ['Junior Video Editor', 'Senior Video Editor'],
      },
    ]);
  });

  it('groups by team in the organisation’s order (a department’s own job titles under it), by name within a team; C-level never; a team with none left out', () => {
    const all = cvPositions(TEAMS, TITLES);
    expect(positionGroups(all, { withHidden: false })).toEqual([
      { teamId: 'production', team: 'Production', positions: [{ key: 'production:head of production', name: 'Head of Production' }] },
      {
        teamId: 'video',
        team: 'Video',
        positions: [
          { key: 'video:motion designer', name: 'Motion Designer' },
          { key: 'video:video editor', name: 'Video Editor' },
        ],
      },
      { teamId: 'content-prod', team: 'Content (Production)', positions: [{ key: 'content-prod:copywriter', name: 'Copywriter' }] },
      {
        teamId: 'content-mkt',
        team: 'Content (Marketing)',
        positions: [
          { key: 'content-mkt:copywriter', name: 'Copywriter' },
          { key: 'content-mkt:head of content', name: 'Head of Content' },
        ],
      },
    ]);
    expect(all.some((p) => p.teamId === 'board' || p.name.includes('Chief'))).toBe(false);
    expect(all.some((p) => p.teamId === 'gone' || p.teamId === 'empty')).toBe(false);
  });

  it('keeps the same name in two teams as two positions, one under each, with a key each', () => {
    const copywriters = cvPositions(TEAMS, TITLES).filter((p) => p.name === 'Copywriter');
    expect(copywriters.map((p) => [p.key, p.team, p.teamHrName, p.titleIds])).toEqual([
      ['content-prod:copywriter', 'Content (Production)', 'Content · Production', ['t5']],
      ['content-mkt:copywriter', 'Content (Marketing)', 'Content · Marketing', ['t6', 't9']],
    ]);
  });

  it('HR’s choices by key: a hidden one off the careers page but on HR’s list, marked; a public name shown instead', () => {
    const choices = new Map([
      ['video:motion designer', { hidden: true, publicName: null }],
      ['video:video editor', { hidden: false, publicName: '  Video   Editing Artist ' }],
      ['nobody:gone', { hidden: true, publicName: 'Gone' }],
    ]);
    const all = cvPositions(TEAMS, TITLES, choices);
    const editor = all.find((p) => p.key === 'video:video editor')!;
    expect(editor).toMatchObject({ name: 'Video Editor', publicName: 'Video Editing Artist', shownName: 'Video Editing Artist', hidden: false });
    const careers = positionGroups(all, { withHidden: false }).find((g) => g.teamId === 'video')!;
    expect(careers.positions).toEqual([{ key: 'video:video editor', name: 'Video Editing Artist' }]);
    const hr = positionGroups(all, { withHidden: true }).find((g) => g.teamId === 'video')!;
    expect(hr).toEqual({
      teamId: 'video',
      team: 'Video · Production',
      positions: [
        { key: 'video:motion designer', name: 'Motion Designer', hidden: true },
        { key: 'video:video editor', name: 'Video Editing Artist', hidden: false },
      ],
    });
    // a team whose positions are all hidden is left off the careers page
    const allHidden = cvPositions(TEAMS, TITLES, new Map([['production:head of production', { hidden: true, publicName: null }]]));
    expect(positionGroups(allHidden, { withHidden: false }).map((g) => g.teamId)).not.toContain('production');
    // a new job title's position: shown, by its own name
    expect(cvPositions(TEAMS, [...TITLES, title('t11', 'Colourist', 'video')], choices).find((p) => p.key === 'video:colourist')).toMatchObject({ hidden: false, shownName: 'Colourist' });
  });

  it('HR’s save: a public name too long, a position not on the list', () => {
    const known = new Set(['video:video editor']);
    expect(positionChoiceProblems([{ key: 'video:video editor', hidden: true, publicName: 'Editor' }], known)).toEqual([]);
    expect(positionChoiceProblems([{ key: 'video:video editor', hidden: false, publicName: 'x'.repeat(CV_POSITION_LIMITS.publicName + 1) }], known)).toEqual([
      'Keep each public name to 80 characters or fewer.',
    ]);
    expect(positionChoiceProblems([{ key: 'video:gone', hidden: true }], known)).toEqual(['The positions changed since the page opened: reload it and try again.']);
  });
});
