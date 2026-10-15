// Egyptian universities and faculties, for the employee education fields: HR picks from these lists so the same
// university is always written the same way. Compiled October 2026 from the Supreme Council of Universities (scu.eg),
// the Ministry of Higher Education (mohesr.gov.eg) and its 2026/27 list of accredited institutions, the Council of
// National Universities, presidential decrees and the institutions' own sites, cross-checked with Wikipedia's English
// and Arabic lists. Arabic is as each institution writes it, in standard spelling (ي not ى, hamza kept).
// "unconfirmed" marks a form not seen on the institution's own site or an official list. "Other" (in the form) covers the rest.

export const UNIVERSITY_KINDS = ['public', 'azhar', 'private', 'national', 'technological', 'international', 'academy'] as const;
export type UniversityKind = (typeof UNIVERSITY_KINDS)[number];

export const UNIVERSITY_KIND_LABELS: Record<UniversityKind, string> = {
  public: 'Public universities',
  azhar: 'Al-Azhar',
  private: 'Private universities',
  national: 'National universities',
  technological: 'Technological universities',
  international: 'International branches',
  academy: 'Academies and higher institutes',
};

export interface University {
  en: string;
  ar: string;
  kind: UniversityKind;
}

/**
 * The stored value is `en`. Sorted by kind (in UNIVERSITY_KINDS order), then by English name. Renamed universities keep
 * their old name as its own entry, since certificates carry the name at graduation.
 */
export const UNIVERSITIES: readonly University[] = [
  // Public universities (30)
  { en: 'Ain Shams University', ar: 'جامعة عين شمس', kind: 'public' },
  { en: 'Alexandria University', ar: 'جامعة الإسكندرية', kind: 'public' },
  { en: 'Arish University', ar: 'جامعة العريش', kind: 'public' },
  { en: 'Assiut University', ar: 'جامعة أسيوط', kind: 'public' },
  { en: 'Aswan University', ar: 'جامعة أسوان', kind: 'public' },
  { en: 'Benha University', ar: 'جامعة بنها', kind: 'public' },
  { en: 'Beni-Suef University', ar: 'جامعة بني سويف', kind: 'public' }, // unconfirmed: hyphen (some of its own pages write Beni Suef)
  { en: 'Cairo University', ar: 'جامعة القاهرة', kind: 'public' },
  { en: 'Capital University', ar: 'جامعة العاصمة', kind: 'public' }, // formerly Helwan University (renamed 2025)
  { en: 'Damanhour University', ar: 'جامعة دمنهور', kind: 'public' }, // unconfirmed: English (its site is Arabic only)
  { en: 'Damietta University', ar: 'جامعة دمياط', kind: 'public' },
  { en: 'Fayoum University', ar: 'جامعة الفيوم', kind: 'public' },
  { en: 'Helwan University', ar: 'جامعة حلوان', kind: 'public' }, // renamed Capital University in 2025; kept for graduates' certificates
  { en: 'Hurghada University', ar: 'جامعة الغردقة', kind: 'public' }, // founded 2024; unconfirmed: English (from news and partners)
  { en: 'Kafrelsheikh University', ar: 'جامعة كفر الشيخ', kind: 'public' },
  { en: 'Luxor University', ar: 'جامعة الأقصر', kind: 'public' },
  { en: 'Mansoura University', ar: 'جامعة المنصورة', kind: 'public' },
  { en: 'Matrouh University', ar: 'جامعة مطروح', kind: 'public' }, // unconfirmed: English (its site was unreachable)
  { en: 'Menoufia University', ar: 'جامعة المنوفية', kind: 'public' },
  { en: 'Minia University', ar: 'جامعة المنيا', kind: 'public' },
  { en: 'New Valley University', ar: 'جامعة الوادي الجديد', kind: 'public' },
  { en: 'Port Said University', ar: 'جامعة بورسعيد', kind: 'public' },
  { en: 'Qena University', ar: 'جامعة قنا', kind: 'public' }, // formerly South Valley University (renamed 2025); English form unconfirmed
  { en: 'Sohag University', ar: 'جامعة سوهاج', kind: 'public' },
  { en: 'South Valley University', ar: 'جامعة جنوب الوادي', kind: 'public' }, // renamed Qena University in 2025; kept for graduates' certificates
  { en: 'Suez Canal University', ar: 'جامعة قناة السويس', kind: 'public' },
  { en: 'Suez University', ar: 'جامعة السويس', kind: 'public' }, // unconfirmed: English (its site is Arabic only)
  { en: 'Tanta University', ar: 'جامعة طنطا', kind: 'public' },
  { en: 'University of Sadat City', ar: 'جامعة مدينة السادات', kind: 'public' }, // unconfirmed: English (from WHED; its site was unreachable)
  { en: 'Zagazig University', ar: 'جامعة الزقازيق', kind: 'public' },

  // Al-Azhar (1)
  { en: 'Al-Azhar University', ar: 'جامعة الأزهر', kind: 'azhar' }, // unconfirmed: English (its site was unreachable); one entry for all its faculties and branches

  // Private universities (42)
  { en: 'Ahram Canadian University', ar: 'جامعة الأهرام الكندية', kind: 'private' }, // ACU
  { en: 'Al Hayah University in Cairo', ar: 'جامعة الحياة', kind: 'private' },
  { en: 'Al Ryada University for Science and Technology', ar: 'جامعة الريادة للعلوم والتكنولوجيا', kind: 'private' }, // Sadat City
  { en: 'Al Salam University in Egypt', ar: 'جامعة السلام', kind: 'private' }, // Tanta
  { en: 'Badr University in Assiut', ar: 'جامعة بدر بأسيوط', kind: 'private' },
  { en: 'Badr University in Cairo', ar: 'جامعة بدر بالقاهرة', kind: 'private' }, // BUC
  { en: 'Badya University', ar: 'جامعة باديا', kind: 'private' }, // 6th of October City
  { en: 'City University of Cairo', ar: 'جامعة المدينة بالقاهرة', kind: 'private' },
  { en: 'Delta University for Science and Technology', ar: 'جامعة الدلتا للعلوم والتكنولوجيا', kind: 'private' }, // Gamasa
  { en: 'Deraya University', ar: 'جامعة دراية', kind: 'private' }, // Minya
  { en: 'Egyptian Russian University', ar: 'الجامعة المصرية الروسية', kind: 'private' }, // ERU
  { en: 'Egyptian University in Alamein', ar: 'الجامعة المصرية بالعلمين', kind: 'private' },
  { en: 'El Saleheya El Gadida University', ar: 'جامعة الصالحية الجديدة', kind: 'private' },
  { en: 'ESLSCA University', ar: 'جامعة إسلسكا', kind: 'private' }, // unconfirmed: Arabic (the ministry writes "جامعة اسلسكا"); listed under international agreements
  { en: 'Future University in Egypt', ar: 'جامعة المستقبل', kind: 'private' }, // FUE
  { en: 'German International University', ar: 'الجامعة الألمانية الدولية', kind: 'private' }, // GIU, New Capital; the ministry lists it under international agreements
  { en: 'German University in Cairo', ar: 'الجامعة الألمانية بالقاهرة', kind: 'private' }, // GUC
  { en: 'Heliopolis University', ar: 'جامعة هليوبوليس', kind: 'private' },
  { en: 'Horus University in Egypt', ar: 'جامعة حورس', kind: 'private' }, // New Damietta
  { en: 'Innovation University', ar: 'جامعة الابتكار', kind: 'private' }, // 10th of Ramadan
  { en: 'Lotus University in Minya', ar: 'جامعة اللوتس بالمنيا', kind: 'private' },
  { en: 'May University in Cairo', ar: 'جامعة مايو بالقاهرة', kind: 'private' },
  { en: 'Memphis University', ar: 'جامعة ممفيس', kind: 'private' }, // New Cairo; first intake 2026
  { en: 'Merit University', ar: 'جامعة ميريت', kind: 'private' }, // New Sohag
  { en: 'Misr International University', ar: 'جامعة مصر الدولية', kind: 'private' }, // MIU
  { en: 'Misr University for Science and Technology', ar: 'جامعة مصر للعلوم والتكنولوجيا', kind: 'private' }, // MUST
  { en: 'Modern University for Technology and Information', ar: 'الجامعة الحديثة للتكنولوجيا والمعلومات', kind: 'private' }, // MTI
  { en: 'Nahda University in Beni Suef', ar: 'جامعة النهضة', kind: 'private' }, // NUB
  { en: 'New Egypt University', ar: 'جامعة مصر الجديدة', kind: 'private' }, // first intake 2026; its site writes "جامعة نيو إيجيبت"
  { en: 'Newgiza University', ar: 'جامعة الجيزة الجديدة', kind: 'private' }, // NGU
  { en: 'Nile Valley University', ar: 'جامعة وادي النيل', kind: 'private' }, // Fayoum
  { en: 'Obour University for Science and Technology', ar: 'جامعة العبور للعلوم والتكنولوجيا', kind: 'private' },
  { en: 'October 6 University', ar: 'جامعة 6 أكتوبر', kind: 'private' }, // O6U; often written "6th of October University"
  { en: 'October University for Modern Sciences and Arts', ar: 'جامعة أكتوبر للعلوم الحديثة والآداب', kind: 'private' }, // MSA
  { en: 'Pharos University in Alexandria', ar: 'جامعة فاروس بالإسكندرية', kind: 'private' }, // PUA
  { en: 'Rashid University', ar: 'جامعة رشيد', kind: 'private' },
  { en: 'Sinai University', ar: 'جامعة سيناء', kind: 'private' },
  { en: 'Sphinx University', ar: 'جامعة سفنكس', kind: 'private' }, // New Assiut
  { en: 'The American University in Cairo', ar: 'الجامعة الأمريكية بالقاهرة', kind: 'private' }, // AUC; the ministry lists it under international agreements
  { en: 'The British University in Egypt', ar: 'الجامعة البريطانية في مصر', kind: 'private' }, // BUE
  { en: 'The Egyptian Chinese University', ar: 'الجامعة المصرية الصينية', kind: 'private' }, // ECU
  { en: 'University of East Capital', ar: 'جامعة شرق العاصمة', kind: 'private' },

  // National universities (36)
  { en: 'Ain Shams National University', ar: 'جامعة عين شمس الأهلية', kind: 'national' },
  { en: 'Alamein International University', ar: 'جامعة العلمين الدولية', kind: 'national' }, // unconfirmed: English (its site was unreachable)
  { en: 'Alexandria National University', ar: 'جامعة الإسكندرية الأهلية', kind: 'national' },
  { en: 'Assiut National University', ar: 'جامعة أسيوط الأهلية', kind: 'national' },
  { en: 'Benha National University', ar: 'جامعة بنها الأهلية', kind: 'national' },
  { en: 'Beni Suef National University', ar: 'جامعة بني سويف الأهلية', kind: 'national' }, // its site writes both بني and بنى; بني chosen
  { en: 'Cairo National University', ar: 'جامعة القاهرة الأهلية', kind: 'national' },
  { en: 'Capital National University', ar: 'جامعة العاصمة الأهلية', kind: 'national' }, // formerly Helwan National University; unconfirmed: English
  { en: 'Damanhour National University', ar: 'جامعة دمنهور الأهلية', kind: 'national' },
  { en: 'Damietta National University', ar: 'جامعة دمياط الأهلية', kind: 'national' },
  { en: 'East Port Said National University', ar: 'جامعة شرق بورسعيد الأهلية', kind: 'national' }, // attached to Port Said University
  { en: 'Egypt University of Informatics', ar: 'جامعة مصر للمعلوماتية', kind: 'national' },
  { en: 'Egypt-Japan University of Science and Technology', ar: 'الجامعة المصرية اليابانية للعلوم والتكنولوجيا', kind: 'national' }, // E-JUST; the ministry lists it under international agreements
  { en: 'Egyptian E-Learning University', ar: 'الجامعة المصرية للتعلم الإلكتروني الأهلية', kind: 'national' }, // EELU
  { en: 'Fayoum National University', ar: 'جامعة الفيوم الأهلية', kind: 'national' }, // unconfirmed: English (read from its logo; its site was down)
  { en: 'Galala University', ar: 'جامعة الجلالة', kind: 'national' }, // unconfirmed: Arabic (from the ministry; its site has no Arabic)
  { en: 'Helwan National University', ar: 'جامعة حلوان الأهلية', kind: 'national' }, // rename to Capital National University approved Dec 2025; kept for certificates
  { en: 'Kafrelsheikh National University', ar: 'جامعة كفر الشيخ الأهلية', kind: 'national' },
  { en: 'King Salman International University', ar: 'جامعة الملك سلمان الدولية', kind: 'national' },
  { en: 'Luxor National University', ar: 'جامعة الأقصر الأهلية', kind: 'national' },
  { en: 'Mansoura National University', ar: 'جامعة المنصورة الأهلية', kind: 'national' },
  { en: 'Menoufia National University', ar: 'جامعة المنوفية الأهلية', kind: 'national' },
  { en: 'Minia National University', ar: 'جامعة المنيا الأهلية', kind: 'national' },
  { en: 'National University of Sadat City', ar: 'جامعة مدينة السادات الأهلية', kind: 'national' },
  { en: 'New Ismailia National University', ar: 'جامعة الإسماعيلية الجديدة الأهلية', kind: 'national' }, // attached to Suez Canal University; unconfirmed: English (its site is Arabic only)
  { en: 'New Mansoura University', ar: 'جامعة المنصورة الجديدة', kind: 'national' }, // unconfirmed: both (from the ministry and Wikipedia; its site was unreachable)
  { en: 'New Valley National University', ar: 'جامعة الوادي الجديد الأهلية', kind: 'national' },
  { en: 'Nile University', ar: 'جامعة النيل', kind: 'national' }, // as on its logo; the Supreme Council writes "جامعة النيل الأهلية"
  { en: 'Qena National University', ar: 'جامعة قنا الأهلية', kind: 'national' }, // formerly South Valley National University; unconfirmed: English
  { en: 'Sohag National University', ar: 'جامعة سوهاج الأهلية', kind: 'national' },
  { en: 'South Valley National University', ar: 'جامعة جنوب الوادي الأهلية', kind: 'national' }, // rename to Qena National University approved Dec 2025; kept for certificates
  { en: 'Suez National University', ar: 'جامعة السويس الأهلية', kind: 'national' },
  { en: 'Tanta National University', ar: 'جامعة طنطا الأهلية', kind: 'national' },
  { en: 'Université Française d\'Égypte', ar: 'الجامعة الأهلية الفرنسية في مصر', kind: 'national' }, // French University in Egypt; formerly private
  { en: 'Zagazig National University', ar: 'جامعة الزقازيق الأهلية', kind: 'national' },
  { en: 'Zewail City of Science, Technology and Innovation', ar: 'مدينة زويل للعلوم والتكنولوجيا والابتكار', kind: 'national' }, // non-profit, under its own law

  // Technological universities (14)
  { en: '6th of October Technological University', ar: 'جامعة السادس من أكتوبر التكنولوجية', kind: 'technological' }, // the cabinet text writes "جامعة 6 أكتوبر التكنولوجية"
  { en: 'Assiut International Technological University', ar: 'جامعة أسيوط التكنولوجية الدولية', kind: 'technological' },
  { en: 'Beni Suef Technological University', ar: 'جامعة بني سويف التكنولوجية', kind: 'technological' },
  { en: 'Borg El Arab Technological University', ar: 'جامعة برج العرب التكنولوجية', kind: 'technological' },
  { en: 'Delta Technological University', ar: 'جامعة الدلتا التكنولوجية', kind: 'technological' }, // Quesna
  { en: 'East Port Said Technological University', ar: 'جامعة شرق بورسعيد التكنولوجية', kind: 'technological' },
  { en: 'ElSewedy University of Technology', ar: 'جامعة السويدي للتكنولوجيا', kind: 'technological' }, // private; "Polytechnic of Egypt"
  { en: 'Fayoum International Technological University', ar: 'جامعة الفيوم التكنولوجية الدولية', kind: 'technological' },
  { en: 'Helwan International Technological University', ar: 'جامعة حلوان التكنولوجية الدولية', kind: 'technological' }, // unconfirmed: both; rename to جامعة العاصمة التكنولوجية الدولية approved Sep 2026
  { en: 'New Assiut Technological University', ar: 'جامعة أسيوط الجديدة التكنولوجية', kind: 'technological' },
  { en: 'New Cairo Technological University', ar: 'جامعة القاهرة الجديدة التكنولوجية', kind: 'technological' },
  { en: 'Samannoud Technological University', ar: 'جامعة سمنود التكنولوجية', kind: 'technological' },
  { en: 'Saxony Egypt University for Applied Science and Technology', ar: 'جامعة ساكسوني مصر للعلوم التطبيقية والتكنولوجيا', kind: 'technological' }, // private; unconfirmed: Arabic (the Supreme Council writes "والتكنولوجية")
  { en: 'Taiba Technological University', ar: 'جامعة طيبة الجديدة التكنولوجية', kind: 'technological' }, // Luxor; unconfirmed: Arabic (also written "جامعة طيبة التكنولوجية")

  // International branches (16)
  { en: 'Anglia Ruskin University', ar: 'جامعة أنجليا روسكين', kind: 'international' }, // ARU Cairo at EDIN, first intake 2026; unconfirmed: Arabic
  { en: 'Arab Academy for Science, Technology and Maritime Transport', ar: 'الأكاديمية العربية للعلوم والتكنولوجيا والنقل البحري', kind: 'international' }, // AASTMT, all campuses
  { en: 'Arab Open University - Egypt', ar: 'الجامعة العربية المفتوحة - مصر', kind: 'international' },
  { en: 'Coventry University', ar: 'جامعة كوفنتري', kind: 'international' }, // Egypt branch at The Knowledge Hub (TKH), New Capital
  { en: 'Institute of Arab Research and Studies', ar: 'معهد البحوث والدراسات العربية', kind: 'international' }, // Arab League (ALECSO); unconfirmed: both (from ALECSO and Wikipedia)
  { en: 'Kazan Federal University', ar: 'جامعة كازان الفيدرالية', kind: 'international' }, // Cairo branch
  { en: 'NOVA University Lisbon', ar: 'جامعة نوفا', kind: 'international' }, // NOVA Cairo at TKH; unconfirmed: Arabic (decree wording; the ministry writes "جامعة نوفا البرتغالية")
  { en: 'Senghor University', ar: 'جامعة سنغور', kind: 'international' }, // Université Senghor, Alexandria; the ministry writes "جامعة سنجور"
  { en: 'St. Petersburg State University', ar: 'جامعة سانت بطرسبرج', kind: 'international' }, // Egypt branch, New Cairo
  { en: 'Technische Universität Berlin – Campus El Gouna', ar: 'جامعة برلين الألمانية بالجونة', kind: 'international' }, // unconfirmed: both (Arabic is the ministry's wording); master's only
  { en: 'Toronto Metropolitan University', ar: 'جامعة تورنتو متروبوليتان', kind: 'international' }, // formerly Ryerson; at the Universities of Canada in Egypt; no new intake since 2023; unconfirmed: Arabic
  { en: 'University of Central Lancashire', ar: 'جامعة وسط لانكشاير', kind: 'international' }, // UCLan at EUE
  { en: 'University of East London', ar: 'جامعة إيست لندن', kind: 'international' }, // UEL at EUE
  { en: 'University of Hertfordshire', ar: 'جامعة هيرتفوردشاير', kind: 'international' }, // hosted by the Global Academic Foundation (GAF), New Capital
  { en: 'University of London', ar: 'جامعة لندن', kind: 'international' }, // at European Universities in Egypt (EUE), New Capital
  { en: 'University of Prince Edward Island', ar: 'جامعة جزيرة الأمير إدوارد', kind: 'international' }, // UPEI Cairo, at the Universities of Canada in Egypt (now EDIN)

  // Academies and higher institutes (44)
  { en: 'Academy of Arts', ar: 'أكاديمية الفنون', kind: 'academy' }, // one entry for its institutes (Cinema, Theatre, Conservatoire, Ballet ...)
  { en: 'Akhbar El Youm Academy', ar: 'أكاديمية أخبار اليوم', kind: 'academy' },
  { en: 'Alexandria Higher Institute of Engineering and Technology', ar: 'معهد الإسكندرية العالي للهندسة والتكنولوجيا', kind: 'academy' }, // AIET
  { en: 'Armed Forces College of Medicine', ar: 'كلية الطب بالقوات المسلحة', kind: 'academy' },
  { en: 'Cairo Higher Institute for Engineering, Computer Science and Management', ar: 'معهد القاهرة العالي للهندسة وعلوم الحاسب والإدارة', kind: 'academy' }, // New Cairo; unconfirmed: English
  { en: 'Canadian International College', ar: 'المعهد الكندي العالي', kind: 'academy' }, // CIC; the press writes "الكلية الكندية الدولية"
  { en: 'Culture and Science City', ar: 'مدينة الثقافة والعلوم', kind: 'academy' }, // 6th of October; ten institutes
  { en: 'Delta Higher Institute for Engineering and Technology', ar: 'معهد الدلتا العالي للهندسة والتكنولوجيا', kind: 'academy' }, // Mansoura
  { en: 'Egyptian Academy for Engineering and Advanced Technology', ar: 'الأكاديمية المصرية للهندسة والتكنولوجيا المتقدمة', kind: 'academy' }, // Ministry of Military Production; unconfirmed: English
  { en: 'Egyptian Air College', ar: 'الكلية الجوية', kind: 'academy' }, // unconfirmed: English (also "Egyptian Air Academy")
  { en: 'Egyptian Air Defense College', ar: 'كلية الدفاع الجوي', kind: 'academy' }, // unconfirmed: English
  { en: 'Egyptian Institute of Alexandria Academy for Management and Accounting', ar: 'المعهد المصري لأكاديمية الإسكندرية للإدارة والمحاسبة', kind: 'academy' }, // EIA
  { en: 'Egyptian Military Academy', ar: 'الأكاديمية العسكرية المصرية', kind: 'academy' }, // since 2022 the umbrella over the military colleges; unconfirmed: English
  { en: 'Egyptian Military College', ar: 'الكلية الحربية', kind: 'academy' }, // unconfirmed: English (before 2022 called the Egyptian Military Academy)
  { en: 'Egyptian Naval College', ar: 'الكلية البحرية', kind: 'academy' }, // unconfirmed: English (also "Egyptian Naval Academy")
  { en: 'El Gezira Higher Institute', ar: 'معهد الجزيرة العالي', kind: 'academy' }, // Mokattam; unconfirmed: English
  { en: 'El Shorouk Academy', ar: 'أكاديمية الشروق', kind: 'academy' }, // includes the Higher Institute of Engineering in El Shorouk City
  { en: 'Giza Higher Institute of Engineering and Technology', ar: 'معهد الجيزة العالي للهندسة والتكنولوجيا', kind: 'academy' },
  { en: 'Higher Institute of Social Work in Alexandria', ar: 'المعهد العالي للخدمة الاجتماعية بالإسكندرية', kind: 'academy' }, // unconfirmed: English
  { en: 'Higher Institute of Social Work in Cairo', ar: 'المعهد العالي للخدمة الاجتماعية بالقاهرة', kind: 'academy' }, // unconfirmed: English
  { en: 'Higher Institute of Tourism and Hotels in Alexandria (EGOTH)', ar: 'المعهد العالي للسياحة والفنادق بالإسكندرية (إيجوث)', kind: 'academy' },
  { en: 'Higher Institute of Tourism and Hotels in Ismailia (EGOTH)', ar: 'المعهد العالي للسياحة والفنادق بالإسماعيلية (إيجوث)', kind: 'academy' }, // unconfirmed: English
  { en: 'Higher Institute of Tourism and Hotels in Luxor (EGOTH)', ar: 'المعهد العالي للسياحة والفنادق بالأقصر (إيجوث)', kind: 'academy' },
  { en: 'Higher Technological Institute', ar: 'المعهد التكنولوجي العالي', kind: 'academy' }, // HTI, 10th of Ramadan
  { en: 'Information Technology Institute', ar: 'معهد تكنولوجيا المعلومات', kind: 'academy' }, // ITI; professional diploma, not a degree
  { en: 'Institute of Aviation Engineering and Technology', ar: 'معهد هندسة وتكنولوجيا الطيران', kind: 'academy' }, // IAET, Imbaba
  { en: 'International Academy for Engineering and Media Sciences', ar: 'الأكاديمية الدولية للهندسة وعلوم الإعلام', kind: 'academy' }, // 6th of October; unconfirmed: English
  { en: 'King Mariout Higher Institutes', ar: 'المعاهد العليا كينج مريوط', kind: 'academy' }, // Alexandria
  { en: 'Madina Higher Institutes', ar: 'معاهد المدينة العليا', kind: 'academy' }, // Shubra Ment
  { en: 'Military Academy for Postgraduate and Strategic Studies', ar: 'الأكاديمية العسكرية للدراسات العليا والاستراتيجية', kind: 'academy' }, // formerly Nasser Higher Military Academy; unconfirmed: both (from Wikipedia)
  { en: 'Military Medical Academy', ar: 'الأكاديمية الطبية العسكرية', kind: 'academy' }, // postgraduate; unconfirmed: English
  { en: 'Military Technical College', ar: 'الكلية الفنية العسكرية', kind: 'academy' },
  { en: 'Misr Higher Institute for Commerce and Computers', ar: 'معهد مصر العالي للتجارة والحاسبات', kind: 'academy' }, // Mansoura; unconfirmed: English
  { en: 'Modern Academy for Computer Science and Management Technology in Maadi', ar: 'الأكاديمية الحديثة لعلوم الكمبيوتر وتكنولوجيا الإدارة بالمعادي', kind: 'academy' },
  { en: 'Modern Academy for Engineering and Technology in Maadi', ar: 'الأكاديمية الحديثة للهندسة والتكنولوجيا بالمعادي', kind: 'academy' },
  { en: 'Nasser Higher Military Academy', ar: 'أكاديمية ناصر العسكرية العليا', kind: 'academy' }, // former name, kept for older certificates; from Wikipedia
  { en: 'New Cairo Academy', ar: 'أكاديمية القاهرة الجديدة', kind: 'academy' }, // unconfirmed: Arabic (its site writes "معاهد القاهرة الجديدة بالتجمع الخامس")
  { en: 'Obour Institutes', ar: 'معاهد العبور', kind: 'academy' },
  { en: 'October High Institute for Engineering and Technology', ar: 'معهد أكتوبر العالي للهندسة والتكنولوجيا', kind: 'academy' },
  { en: 'Police Academy', ar: 'أكاديمية الشرطة', kind: 'academy' },
  { en: 'Pyramids Higher Institute for Engineering and Technology', ar: 'معهد الأهرامات العالي للهندسة والتكنولوجيا', kind: 'academy' }, // 6th of October; unconfirmed: English
  { en: 'Sadat Academy for Management Sciences', ar: 'أكاديمية السادات للعلوم الإدارية', kind: 'academy' },
  { en: 'Thebes Academy', ar: 'أكاديمية طيبة', kind: 'academy' },
  { en: 'Valley Higher Institutes', ar: 'معاهد الوادي العليا', kind: 'academy' }, // Obour; unconfirmed: English
];

export interface Faculty {
  en: string;
  ar: string;
}

/** The stored value is `en` (the subject, without "Faculty of" / "كلية"). Sorted by English name. */
export const FACULTIES: readonly Faculty[] = [
  { en: 'African Postgraduate Studies', ar: 'الدراسات الأفريقية العليا' }, // Cairo
  { en: 'Agricultural Engineering', ar: 'الهندسة الزراعية' }, // Al-Azhar; unconfirmed: English
  { en: 'Agriculture', ar: 'الزراعة' },
  { en: 'Al-Alsun', ar: 'الألسن' }, // languages
  { en: 'Applied Arts', ar: 'الفنون التطبيقية' },
  { en: 'Applied Health Sciences Technology', ar: 'تكنولوجيا العلوم الصحية التطبيقية' }, // also Applied Health / Medical Sciences
  { en: 'Arabic Language', ar: 'اللغة العربية' }, // Al-Azhar
  { en: 'Archaeology', ar: 'الآثار' },
  { en: 'Art Education', ar: 'التربية الفنية' },
  { en: 'Artificial Intelligence', ar: 'الذكاء الاصطناعي' },
  { en: 'Arts', ar: 'الآداب' }, // also Arts and Humanities
  { en: 'Arts and Design', ar: 'الفنون والتصميم' }, // private universities; unconfirmed: Arabic
  { en: 'Biotechnology', ar: 'التكنولوجيا الحيوية' },
  { en: 'Business Administration', ar: 'إدارة الأعمال' }, // private universities; also Management Sciences
  { en: 'Commerce', ar: 'التجارة' }, // also "Faculty of Business" and Commerce and Business Administration
  { en: 'Computer Science', ar: 'علوم الحاسب' }, // private universities; also Informatics and Computer Science; unconfirmed: Arabic
  { en: 'Computers and Artificial Intelligence', ar: 'الحاسبات والذكاء الاصطناعي' },
  { en: 'Computers and Information', ar: 'الحاسبات والمعلومات' }, // also "Computer and Information Sciences" (Ain Shams)
  { en: 'Computers and Information Technology', ar: 'الحاسبات وتكنولوجيا المعلومات' }, // also Information Technology; unconfirmed: Arabic
  { en: 'Computing and Data Science', ar: 'الحاسبات وعلوم البيانات' }, // Alexandria
  { en: 'Dar Al-Uloom', ar: 'دار العلوم' },
  { en: 'Dentistry', ar: 'طب الأسنان' }, // also Oral and Dental Medicine (طب الفم والأسنان)
  { en: 'Earth Sciences', ar: 'علوم الأرض' }, // Beni-Suef; unconfirmed: English
  { en: 'Economics and Political Science', ar: 'الاقتصاد والعلوم السياسية' }, // also Politics and Economics
  { en: 'Education', ar: 'التربية' },
  { en: 'Education for Early Childhood', ar: 'التربية للطفولة المبكرة' }, // formerly Kindergarten
  { en: 'Electronic Engineering', ar: 'الهندسة الإلكترونية' }, // Menoufia; unconfirmed: English
  { en: 'Energy Engineering', ar: 'هندسة الطاقة' }, // Aswan; unconfirmed: Arabic
  { en: 'Engineering', ar: 'الهندسة' },
  { en: 'Fine Arts', ar: 'الفنون الجميلة' },
  { en: 'Fish Resources', ar: 'الثروة السمكية' }, // also Fisheries; unconfirmed: English
  { en: 'Graduate Studies and Environmental Research', ar: 'الدراسات العليا والبحوث البيئية' }, // Ain Shams
  { en: 'Graduate Studies for Education', ar: 'الدراسات العليا للتربية' }, // Cairo
  { en: 'Graduate Studies for Statistical Research', ar: 'الدراسات العليا للبحوث الإحصائية' }, // Cairo
  { en: 'Holy Quran for Quranic Readings and Its Sciences', ar: 'القرآن الكريم للقراءات وعلومها' }, // Al-Azhar; unconfirmed: English
  { en: 'Home Economics', ar: 'الاقتصاد المنزلي' },
  { en: 'Human Studies', ar: 'الدراسات الإنسانية' }, // Al-Azhar; unconfirmed: English
  { en: 'Industrial Education', ar: 'التعليم الصناعي' }, // renamed Technology and Education; kept for older certificates
  { en: 'Industry and Energy Technology', ar: 'تكنولوجيا الصناعة والطاقة' }, // technological universities; unconfirmed: English
  { en: 'Islamic and Arabic Studies', ar: 'الدراسات الإسلامية والعربية' }, // Al-Azhar; also Islamic Studies
  { en: 'Islamic Dawah', ar: 'الدعوة الإسلامية' }, // Al-Azhar; unconfirmed: English
  { en: 'Kindergarten', ar: 'رياض الأطفال' }, // renamed Education for Early Childhood; kept for older certificates
  { en: 'Languages and Translation', ar: 'اللغات والترجمة' },
  { en: 'Law', ar: 'الحقوق' },
  { en: 'Management Technology and Information Systems', ar: 'تكنولوجيا الإدارة ونظم المعلومات' }, // Port Said
  { en: 'Maritime Transport and Technology', ar: 'النقل البحري والتكنولوجيا' }, // AASTMT; unconfirmed: both
  { en: 'Mass Communication', ar: 'الإعلام' }, // also Media
  { en: 'Medicine', ar: 'الطب' },
  { en: 'Music Education', ar: 'التربية الموسيقية' },
  { en: 'Nanotechnology for Postgraduate Studies', ar: 'الدراسات العليا للنانو تكنولوجي' }, // Cairo
  { en: 'Navigation Science and Space Technology', ar: 'علوم الملاحة وتكنولوجيا الفضاء' }, // Beni-Suef; unconfirmed: English
  { en: 'Nursing', ar: 'التمريض' },
  { en: 'Nutrition Sciences', ar: 'علوم التغذية' }, // Capital (Helwan)
  { en: 'Petroleum and Mining Engineering', ar: 'هندسة البترول والتعدين' }, // Suez; unconfirmed: English
  { en: 'Pharmacy', ar: 'الصيدلة' },
  { en: 'Physical Education', ar: 'التربية الرياضية' }, // renamed Sports Sciences; kept for older certificates
  { en: 'Physical Therapy', ar: 'العلاج الطبيعي' },
  { en: 'Postgraduate Studies of Childhood', ar: 'الدراسات العليا للطفولة' }, // Ain Shams
  { en: 'Science', ar: 'العلوم' },
  { en: 'Sharia and Law', ar: 'الشريعة والقانون' }, // Al-Azhar
  { en: 'Social Work', ar: 'الخدمة الاجتماعية' },
  { en: 'Specific Education', ar: 'التربية النوعية' },
  { en: 'Sports Sciences', ar: 'علوم الرياضة' }, // formerly Physical Education
  { en: 'Technology and Education', ar: 'التكنولوجيا والتعليم' }, // formerly Industrial Education
  { en: 'Tourism and Hotels', ar: 'السياحة والفنادق' },
  { en: 'Urban and Regional Planning', ar: 'التخطيط الإقليمي والعمراني' }, // Cairo
  { en: 'Usul Al-Din (Fundamentals of Religion)', ar: 'أصول الدين' }, // Al-Azhar; also أصول الدين والدعوة; unconfirmed: English
  { en: 'Veterinary Medicine', ar: 'الطب البيطري' },
  { en: 'Women for Arts, Science and Education', ar: 'البنات للآداب والعلوم والتربية' }, // Ain Shams; unconfirmed: English (its site says "Faculty of Women")
];
