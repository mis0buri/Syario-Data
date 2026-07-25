// ── 弐寺(beatmania IIDX) SP☆12 地力表 シードデータ ──
// 出典: https://w.atwiki.jp/bemani2sp11/pages/19.html （SP☆12 地力表）を参考にした初期データ。
// wiki は随時更新されるため、このファイルはあくまで初期表示用のシード。
// 最新の表はページ内の「表を更新」から wiki のコピペで取り込み、Firestore
// (iidx_config/table) に保存されたものが優先される。
// 曲名がランプ保存のキーになるため、表記ゆれ（†・全角半角など）を変えると
// 既存ランプと紐付かなくなる点に注意。
const IIDX_SEED_TABLE = [
  { tier: '地力S+', songs: [
    '冥', 'X-DEN', 'Mare Nectaris', '灼熱Beach Side Bunny', '灼熱Pt.2 Long Train Running',
    'Verflucht†', '疾風迅雷†', 'KAMAITACHI†', 'Chrono Diver -PENDULUMs-†', 'ピアノ協奏曲第1番"蠍火"†',
    'Sinus Iridum', 'GuNGNiR†', 'Everlasting Message†', 'EXUSIA†', 'IX†',
    'The Chase†', 'Ancient Scapes†', 'invoker', 'Timepiece phase II (CN Ver.)', 'お米の美味しい炊き方、そしてお米を食べることによるその効果。†'
  ]},
  { tier: '個人差S+', songs: [
    'DEATH†ZIGOQ ～怒りの高速爆走野郎～', 'quell～the seventh slave～', 'Almagest', '嘹亮', 'rage against usual'
  ]},
  { tier: '地力S', songs: [
    'perditus†paradisus', '卑弥呼', 'AA†', 'Go Beyond!!', 'Elemental Creation',
    '天空の夜明け', 'Sigmund†', 'ICARUS†', 'Broken Sword†', 'NEO GENERATOR SEVEN',
    'Feel The Beat†', 'Plan 8', 'JOMANDA', 'Sound Of Giallarhorn', 'ruin of opals',
    'Rave Cannon†', 'CHRONO DIVER -NORNIR-', 'Initiation†', 'BLACK.by X-Cross Fade', 'reunion'
  ]},
  { tier: '個人差S', songs: [
    'Innocent Walls†', 'mosaic†', 'POSSESSION', 'Little Little Princess†', '3y3s',
    'Level One', 'MENDES', 'Antigravity', 'The Limbo', 'ZZ'
  ]},
  { tier: '地力A+', songs: [
    'Confiserie', 'Sigmund', 'AA', 'Verflucht', 'Xperanza',
    'Valanga', 'Sense 2007', 'GENE', 'DIAVOLO', '疾風迅雷',
    'S!ck', 'The Sampling Paradise', '仮想空間の旅人たち', 'Symmetry', 'EXUSIA',
    'Ancient Scapes', 'IX', 'STULTI', 'Snakey Kung-fu', '† (Dagger)'
  ]},
  { tier: '個人差A+', songs: [
    'ワルツ第17番 ト短調"大犬のワルツ"', 'Blue Rain†', 'DIAMOND CROSSING', 'PARANOiA ～HADES～', 'TOGAKUSHI',
    'ANCHOR', 'Painful Fate', 'Sound Of Giallarhorn (A)', 'HAERETICUS', 'm1dy Deluxe'
  ]},
  { tier: '地力A', songs: [
    'quasar', 'Almace', 'Colorful Cookie', 'Life Is A Game†', 'AO-1',
    'Broken', 'ECHIDNA', 'Fascination MAXX', 'GAIA', 'MENDES (A)',
    'One More Lovely', 'Quakes', 'Thor\'s Hammer', 'Trill auf G', 'VANESSA',
    'ZETA ～素数の世界と超越者～', 'perditus†paradisus (A)', '華麗なる大犬円舞曲', 'Session 9 -Chronicles-', 'The Black Knight',
    'Dynamite', 'Sky High', 'Devilz Sacrifice -謀略の反乱-', 'KAISER PHOENIX', 'CODE:1'
  ]},
  { tier: '個人差A', songs: [
    'Scripted Connection⇒ A mix', 'DAY DREAM', '嘆きの樹', 'rumrum triplets', 'Todestrieb',
    'Watch Out Pt.2', 'BRAINSTORM', 'STEEL NEEDLE', 'ラクエン', 'refractive index'
  ]},
  { tier: '地力B+', songs: [
    'ABSOLUTE (A)', 'Arca', 'Beat Radiance', 'Blue Spring Express', 'Caldwell 99',
    'CONTRACT', 'Dances with Snow Fairies', 'EBONY & IVORY', 'gigadelic', 'GRID KNIGHT',
    'Idola', 'in the Sky', 'KAMIKAZE', 'Level 5', 'MA',
    'NNRT', 'Papilio ulysses', 'Prey', 'Red. by Full Metal Jacket', 'Sinus Iridum (A)',
    'The Least 100sec', 'TITANS RETURN', 'Uh-Oh', 'w/o defense', 'ヒソテンソク'
  ]},
  { tier: '個人差B+', songs: [
    'BITTER CHOCOLATE STRIKER', 'CHECKING YOU OUT', 'Chrono Diver -PENDULUMs-', 'DUE TOMORROW', 'EMERALDAS',
    'GAMBOL (dub mix)', 'naptime', 'quell (A)', 'spiral galaxy', 'ピアノ協奏曲第1番"蠍火"'
  ]},
  { tier: '地力B', songs: [
    'Acid Pumper', 'AsiaN distractive', 'Bad Maniacs', 'BLUST OF WIND', 'Boomy and The Boost',
    'CHRONO DIVER -NORNIR- (A)', 'Cosmic Cat', 'DRAGONLADY', 'DropZ-Line-', 'EMPTY OF THE SKY',
    'Feel The Beat', 'FUZIN RIZIN', 'G59', 'HADES', 'ICARUS',
    'Illegal Function Call', 'KAMAITACHI', 'Kailua', 'KILL EACH OTHER', 'Line 4 Ruin',
    'MAX 300', 'Monopole.', 'NEBULA GRASPER', 'ObZOKe', 'oratio',
    'Preserved Valkyria', 'Programmed Sun', 'Raison d\'être～交差する宿命～', 'Rave*it!! Rave*it!!', 'Recollect Lines',
    'rurple crayon', 'SCREAM SQUAD', 'shady breeze', 'Sol Cosine Job 2', 'STARLIGHT DANCEHALL',
    'THANK YOU FOR PLAYING', 'The Dirty of Loudness', 'THE SAFARI', 'Titania', 'TRANOID',
    'True Blue', 'Turii ～Panta rhei～', 'Valgus', 'Watch Out Pt.2 (A)', 'X-rated'
  ]},
  { tier: '個人差B', songs: [
    'ALBIDA', 'Anisakis -somatic mutation type "Forza"-', 'CROSSROAD', 'Digitank System', 'DOMINION',
    'EDEN', 'era (nostalmix)', 'GENOCIDE', 'JACKAL', 'Karva Chauth',
    'moon_child', 'One of A Kind', 'quell～the seventh slave～ (A)', 'Sounds Of Summer', 'tiefsee',
    'ULTIMATE POWER', 'カジノファイヤーことみちゃん', '共鳴遊戯の華', '龍と少女とデコヒーレンス', '桜'
  ]},
  { tier: '地力C', songs: [
    '100% minimoo-G', 'Aegis', 'AGEHA', 'Ancient Scapes (N)', 'B4U(BEMANI FOR YOU MIX)',
    'Beyond The Earth', 'bit mania', 'Blaze it UP!', 'burst!', 'Candy Galy',
    'Close the World feat.a☆ru', 'Cookie Bouquets', 'crew', 'D', 'DEADHEAT',
    'Despair of ELFERIA', 'DIAMOND CROSSING (N)', 'diagram', 'Double Dribble', 'Dr. Chemical & Killing Machine',
    'entelecheia', 'EXTREME MACH COLLIDER', 'FIRE FIRE', 'four pieces of heaven', 'Fly Above',
    'fog', 'GO OVER WITH GLARE', 'GRADIUSIC CYBER ～AMD G5 MIX～', 'HYPERION', 'IMPLANTATION',
    'Ignis†', 'Juggernaut', 'Just a Little Smile', 'LASER CRUSTER', 'Lethal Weapon',
    'lower world', 'MACHINE GUN MACHINE', 'MAX LOVE', 'mind the gap', 'NEMESIS',
    'NEW SENSATION', 'noname', 'On the FM', 'ODIN', 'PARADISE LOST',
    'PLEASE DON\'T GO', 'Present My Heart', 'Programmed World', 'Punch Love 仮面', 'Rampage',
    'Reflux', 'ridiculous speed', 'Rise\'n Beauty', 'SAMURAI-Scramble', 'Say YEEEAHH',
    'Secrets', 'Sky Is The Limit', 'snow storm', 'SOLID STATE SQUAD', 'STEEL HUNTER',
    'Sweet Sweet Magic', 'TA・DA☆YO・SHI', 'THE BRAVE MUST DIE', 'The Rebellion of Sequencer', 'Time to Air',
    'toran2000', 'Triple Counter', 'waxing and wanding', 'You\'ll say "Now!"', 'ZED',
    '喧嘩ップル', '疾走あんさんぶる', '重装甲戦闘機兵ドーラ', '晴天Bon Voyage', '轟け！恋のビーンボール！！'
  ]},
  { tier: '個人差C', songs: [
    'AinoueVibration', 'ANDROMEDA II', 'Beastie Starter', 'Bounce Bounce Bounce', 'CaptivAte～誓い～',
    'Chain of pain', 'chrono diver -fragment-', 'DENJIN AKATSUKINI TAORERU -SF PureAnalogSynth Mix-', 'Devil\'s Gear', 'Dopamine',
    'ExecutioN', 'e-motion 2003 -romantic extra-', 'Fire Beat', 'fffff', 'GENERATE',
    'HARD BRAIN', 'Hormiga obrera', 'INSOMNIA', 'Innocent Walls', 'LethaL',
    'mosaic', 'NEO IMPRESSIONISM', 'PENDUAL TALISMAN', 'rainbow rainbow', 'RED ZONE',
    'Session 12 -Esther-', 'stoic (EXTREME MIX)', 'TIEFSEE (N)', 'wild and drunk', '津軽雪'
  ]},
  { tier: '地力D', songs: [
    '1st Samurai', 'AA -rebuild-', 'ALL RIGHT', 'Amazing Mirage', 'ATOMIC AGE',
    'Attack the music', 'BLACK JACKAL', 'Blue Rain', 'CALL', 'CaptivAte2～覚醒～',
    'CBTM', 'Chrono Seeker', 'Cyber Force', 'DEEP ROAR', 'Digital MinD',
    'DoLL', 'donburi Fields Forever', 'Drastic Dramatic', 'DXY!', 'evergreen',
    'Evans', 'EXTREME', 'Fegrix', 'Feel The Beat (N)', 'FUZIN RIZIN (N)',
    'GET READY!!', 'Go Ahead!!', 'GRID KNIGHT (N)', 'Halfway of promise', 'Hypersonik',
    'ILLUSION', 'in motion', 'INFERNO', 'Innocent Azure', 'KAISER PHOENIX (N)',
    'Last Dance', 'LOVE B.B.B', 'M4K3 1T B34T', 'MedaLLic', 'MIRACLE MEETS',
    'NINJA IS DEAD IIDX ver.', 'NZM', 'ostinato', 'Painful Fate (N)', 'PARANOIA ～HADES～ (N)',
    'peace of mind', 'Persephone', 'PLASMA SOUL NIGHT', 'protoflicker', 'Quick Silver',
    'RAGE feat.優介', 'Reprologue', 'ristaccia', 'Routing', 'satellite020712 from "CODED ARMS"',
    'Scarlet Moon', 'SEQUENCE CAT', 'Shooting Fireball', 'smooooch・∀・', 'SpaceLand☆TOYBOX',
    'spectrum', 'StrayedCatz', 'Sun Field', 'Super Rush', 'Take My Life',
    'The Story Begins', 'Thunderbolt', 'Timepiece phase II', 'together 4ever', 'TOXIC VIBRATION',
    'traces', 'TWO-TORIAL', 'VOX RUSH', 'V2', 'ünion',
    'ワルツ第17番 ト短調"大犬のワルツ" (N)', '少年A', '打打打打打打打打打打', '表裏一体！？怪盗いいんちょの悩み♥', '革命'
  ]},
  { tier: '個人差D', songs: [
    'ABSOLUTE', 'Blind Justice ～Torn souls, Hurt Faiths～', 'CaptivAte～裁き～', 'Colors (radio edit)', 'DAWN -THE NEXT ENDEAVOUR-',
    'gigadelic (N)', 'HIGH', 'I\'m Screaming LOVE', 'JOURNEY TO THE NEW WORLD', 'KEY',
    'Marie Antoinette', 'quell', 'rainbow flyer', 'SOLITON BEAM', 'sync (EXTREME MIX)',
    'THE DEEP STRIKER', 'ay carumba!!!!', 'キャトられ♥恋はモ～モク', '仮想空間の旅人たち (N)', '灼熱 (N)'
  ]},
  { tier: '地力E', songs: [
    '2hot2eat', 'Abraxas', 'ADVANCE', 'AFTER BURNER', 'Answer',
    'armond', 'Ascalon', 'AVE DE RAPINA', 'BLOCKS', 'Bounce Trippy',
    'Breaking the ground', 'CHECKING YOU OUT (N)', 'CONCEPTUAL', 'Critical Crystal', 'crossover',
    'diving money', 'EXE', 'FAKE TIME', 'fallen leaves -IIDX edition-', 'Flashes',
    'Frozen Ray', 'Get On Beat (Wild Style)', 'GiGaGaHell', 'Golden Palms', 'Hydrogen Blueback',
    'ICARUS (N)', 'IMAGE -MATERIAL-', 'in the Sky (N)', 'Kung-fu Empire', 'MAX 360',
    'MINT', 'NoN-Fiction Story!', 'oratio (N)', 'Outbreak', 'over there',
    'PENTA', 'Phoenix', 'quick and easy', 'Raise your head', 'Red. by Jack Trance',
    'Regulus', 'rumrum triplets (N)', 'sakura storm', 'Session 1 -Genesis-', 'SHADE',
    'Sounds Of Summer (N)', 'STEP INTO THE NEW WORLD', 'Sunrise', 'THANK YOU FOR PLAYING (N)', 'The Hope of Tomorrow',
    'Vermillion', 'virtual crime', 'Wanna Party?', 'Xenon', 'ZENDEGI DANCE',
    '¡Viva!', 'お空、みューじあむ。', 'この子の七つのお祝いに', 'シムルグの目醒め', 'ピアノ独奏無言歌"灰燼"'
  ]},
  { tier: '個人差E', songs: [
    'Aurora', 'BLO$$OM', 'CS Special Medley', 'Dazzlin\' Darlin', 'EMPIRE STATE GLORY',
    'FIRE FIRE (N)', 'Innocent Walls (H)', 'LOVE SHINE', 'No.13', 'one or eight',
    'Present My Heart (N)', 'ra\'am', 'THE FANG', 'ZERO-G', '蛇神'
  ]},
  { tier: '地力F', songs: [
    '5.1.1. (A)', 'Agnus Dei', 'ALFARSHEAR ～双神威に廻る夢～', 'aurora borealis', 'Blame',
    'Blue Comet', 'Catch Our Fire!', 'CROSSROAD (N)', 'Dance to Blue (A)', 'DEATH†ZIGOQ (N)',
    'dissolve', 'earth-like planet', 'EXTREME (N)', 'Fantasy', 'Feel the Earth',
    'Go Berzerk', 'Holic', 'I know You know', 'Innocent Walls (N)', 'LAB',
    'LOVE IS ORANGE', 'Mermaid girl -秋葉工房mix-', 'NEBULA GRASPER (N)', 'No Border', 'PP',
    'RESONATE 1794', 'Sense 2007 (N)', 'spring rain', 'State Of The Art', 'sync',
    'The Sealer ～ア・ミリアとミリアの民～', 'tripping contact', 'VJ ARMY', 'Water Frontier', 'Xepher',
    'YAKSHA', '19,November', '路男', '陽炎', '4.949'
  ]},
];
