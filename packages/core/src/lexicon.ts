/**
 * Shared word lists used by the BM25 tokenizer, the spoiler guard's
 * proper-noun heuristic, and the character-extraction heuristic.
 *
 * These are intentionally plain data (no NLP deps) to keep the package at
 * zero runtime dependencies.
 */

/** Generic English stopwords, used to keep BM25 focused on content words. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  [
    'a','about','above','after','again','against','all','am','an','and','any','are','aren\'t','as','at',
    'be','because','been','before','being','below','between','both','but','by',
    'can','cannot','could','couldn\'t',
    'did','didn\'t','do','does','doesn\'t','doing','don\'t','down','during',
    'each','few','for','from','further',
    'had','hadn\'t','has','hasn\'t','have','haven\'t','having','he','he\'d','he\'ll','he\'s','her','here','here\'s','hers','herself','him','himself','his','how','how\'s',
    'i','i\'d','i\'ll','i\'m','i\'ve','if','in','into','is','isn\'t','it','it\'s','its','itself',
    'just',
    'let\'s',
    'me','more','most','mustn\'t','my','myself',
    'no','nor','not','now',
    'of','off','on','once','only','or','other','ought','our','ours','ourselves','out','over','own',
    'same','shan\'t','she','she\'d','she\'ll','she\'s','should','shouldn\'t','so','some','such',
    'than','that','that\'s','the','their','theirs','them','themselves','then','there','there\'s','these','they','they\'d','they\'ll','they\'re','they\'ve','this','those','through','to','too',
    'under','until','up',
    'very',
    'was','wasn\'t','we','we\'d','we\'ll','we\'re','we\'ve','were','weren\'t','what','what\'s','when','when\'s','where','where\'s','which','while','who','who\'s','whom','why','why\'s','with','won\'t','would','wouldn\'t',
    'you','you\'d','you\'ll','you\'re','you\'ve','your','yours','yourself','yourselves',
    'im','youre','hes','shes','theyre','ive','dont','didnt','cant','wont','isnt','arent',
    'gonna','wanna','gotta','yeah','okay','ok','oh','uh','um','hmm','huh','hey'
  ]
);

/** Days and months are almost never character names. */
export const DAYS_MONTHS: ReadonlySet<string> = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august','september','october','november','december'
]);

/**
 * Words that are commonly capitalized purely because they start a sentence
 * (pronouns, articles, conjunctions, prepositions, discourse markers,
 * interjections) rather than because they are proper nouns. Compared
 * case-insensitively, and checked at *any* position in a sentence — not just
 * sentence-initial — since `spoilerGuard` and `extractCharacters` both need
 * to recognize these as non-names wherever they appear.
 */
export const COMMON_CAPITALIZED_WORDS: ReadonlySet<string> = new Set([
  'the','a','an','he','she','it','they','we','i','you','this','that','these','those',
  'his','her','their','its','our','your','him','them','us',
  'why','what','when','where','who','how','which','whose',
  'if','but','and','or','so','because','then','there','here','yes','no',
  'well','now','also','however','meanwhile','later','earlier','before','after','still','just',
  'maybe','perhaps','actually','basically','currently','certainly','indeed','suddenly',
  'finally','overall','sometimes','often','never','always',
  'nothing','something','everyone','someone','anyone','nobody','everybody','somebody',
  'okay','ok','oh','ah','hey','look','listen','wait','stop','come','go','let','all',
  'some','many','few','one','two','three','four','five','not','no-one',
  'good','great','fine','sure','right','alright','please','thanks','thank',
  // prepositions / conjunctions that commonly open a sentence
  'at','in','on','of','for','to','from','with','without','into','onto','upon',
  'though','although','since','unless','until','once','as','during','while',
  // discourse markers / sentence adverbs
  'instead','otherwise','therefore','thus','hence','anyway','anyhow','besides',
  'moreover','regardless','nonetheless','nevertheless','true','clearly','obviously',
  'naturally','frankly','honestly','surely','apparently','evidently','presumably',
  'supposedly','technically','literally','essentially','ultimately',
  // heading / label / summary words common in LLM answers
  'based','according','additionally','furthermore','mentioned','events','current',
  'status','recap','characters','relationships','summary','note','key','overall',
  'first','second','next','so'
]);

/**
 * Interjections and generic forms of address that regularly precede a comma
 * or a name in dialogue ("Jeez, ...", "Boys, ...", "Hey honey") but are
 * themselves never character names. Compared case-insensitively. Distinct
 * from `COMMON_CAPITALIZED_WORDS` (which is about ordinary sentence-initial
 * capitalization) — these specifically show up in the vocative-address
 * position `extractCharacters` looks at.
 */
export const INTERJECTION_ADDRESS_WORDS: ReadonlySet<string> = new Set([
  'jeez','gee','geez','hey','oh','wow','okay','ok','yeah','boy','boys','man','guys',
  'lord','god','mister','sir','ma\'am','maam','honey','baby','dear','buddy','pal',
  'folks','everybody','everyone','y\'all','yall'
]);

/**
 * Common nouns that ASR / auto-captioning routinely capitalizes mid-sentence
 * (institution and role names, radio-broadcast boilerplate) even though
 * they're not proper names of a specific person. Compared case-insensitively.
 */
export const GENERIC_CAPITALIZED_NOUNS: ReadonlySet<string> = new Set([
  'police','radio','station','church','civil','defense','army','guard','sheriff',
  'mayor','mayors','governor','senate','congress','committee','commission',
  'hospital','morgue','military','national','guardsmen','authorities','officials',
  'news','bulletin','broadcast','network','emergency','headquarters',
  'heat','diner','north','south','east','west'
]);

/** US state names, lowercase — used to filter out place names that would
 * otherwise look like capitalized proper nouns to `extractCharacters`. */
export const US_STATES: ReadonlySet<string> = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'hampshire','jersey','mexico','york','carolina','dakota',
  'ohio','oklahoma','oregon','pennsylvania','rhode','island',
  'tennessee','texas','utah','vermont','virginia','washington',
  'wisconsin','wyoming','columbia'
]);

/**
 * A working list of the ~100 largest US/world cities, lowercase — enough to
 * catch the common case of a place name (often mentioned in broadcast-style
 * dialogue, e.g. "Mayors of Pittsburgh, Philadelphia...") being mistaken for
 * a person's name. Not exhaustive; a real deployment could load a bigger
 * gazetteer, but this package stays at zero runtime dependencies.
 */
export const LARGE_CITIES: ReadonlySet<string> = new Set([
  // US
  'pittsburgh','philadelphia','miami','cumberland','camden','baltimore','washington',
  // (cumberland/camden above are real small/mid-size US cities that showed up
  // directly in real subtitle test data, not part of the "100 largest" list)
  'new york','newyork','brooklyn','manhattan','queens','bronx','boston','chicago',
  'houston','phoenix','san antonio','antonio','san diego','diego','dallas','austin',
  'jacksonville','columbus','charlotte','indianapolis','seattle','denver','portland',
  'memphis','detroit','nashville','oklahoma city','louisville','milwaukee','albuquerque',
  'tucson','fresno','sacramento','atlanta','kansas city','mesa','omaha','raleigh',
  'cleveland','tulsa','honolulu','wichita','arlington','richmond','norfolk','buffalo',
  'pittsburg','cincinnati','st louis','louis','minneapolis','tampa','orlando','anaheim',
  'santa ana','pittsfield','erie','allentown','scranton','harrisburg','york','trenton',
  'newark','jersey city','hartford','providence','burlington','concord','albany',
  'rochester','syracuse','charleston','columbia','savannah','birmingham','montgomery',
  'jackson','little rock','shreveport','baton rouge','el paso','lubbock',
  // world
  'london','paris','tokyo','berlin','moscow','beijing','shanghai','mumbai','delhi',
  'sydney','toronto','mexico city','sao paulo','cairo','lagos','istanbul','bangkok',
  'seoul','madrid','rome','vienna','amsterdam','dublin','lisbon','athens','warsaw',
  'prague','budapest','brussels','stockholm','oslo','helsinki','zurich','geneva',
  'hong kong','singapore','jakarta','manila','karachi','tehran','baghdad','riyadh',
  'dubai','johannesburg','nairobi','buenos aires','lima','bogota','santiago','havana'
]);
