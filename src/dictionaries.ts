/** Theme definitions for steganographic encoding. */

export type ThemeId = 'БОЖЕ' | 'РОССИЯ' | 'СССР' | 'БУХАЮ' | 'КИТАЙ' | 'hex' | 'PATER' | '🙂';

export interface Theme {
  readonly id: ThemeId;
  readonly model: 0 | 16 | 64 | 1024 | 4096;
  readonly rand: number;
  readonly tab1?: readonly string[];
  readonly tab2?: readonly string[];
  readonly tab3?: readonly string[];
  readonly base?: number;
  /** model-1024: string of 1024 characters, one per token. */
  readonly chars?: string;
  readonly sep?: readonly string[];
  /** TTS language code (default: 'ru-RU') */
  readonly lang?: string;
}

const BOZHE: Theme = {
  id: 'БОЖЕ',
  model: 64,
  rand: 0.8,
  tab1: [' и ', ' да ', ', ', ' но '],
  tab2: ['. Кто ', '. Не ', '? А ', ' - '],
  tab3: (
    'раб ад рай бес мир живот грех Господь Всевышний Творец '
    + 'Сущий Владыка Царь Отец Сын Дух богатый нищий постившийся убозий '
    + 'демон Ангел святой благочестивый боголюбивый благоразумный поруганный грешный сумняся бояся '
    + 'лишися ничимже ничтоже достиже радуяся трудяся огорчися глаголя дарствуя видяше '
    + 'Воскресе насладится милует угождает внидет празднует приимет спасет сумнится приступит '
    + 'устрашится целует дает дарствует благодарит благоволит возвеселится приемлет почитает хвалит '
    + 'дарует явится заплачет низложится'
  ).split(' '),
} as const;

const ROSSIYA: Theme = {
  id: 'РОССИЯ',
  model: 16,
  rand: 0.5,
  tab1: [
    '🇿 ', '🙋', '🅉 ', '🙏', '🇷🇺',
    '✊', '💯', '❤️', '👊', '💪',
    '🔥', '⭐', '🚀', '🚩', '👏', '✨',
  ],
  tab2: [
    'ХРАНИ ', 'СЛАВА ', 'БОГ ', 'ЗОВ ', 'СВО ',
    'ПАРНИ ', 'БОЖЕ ', 'НАШИ ', 'БЛАГОСЛОВИ ', 'АНГЕЛЫ ',
    'СПАСИБО ', 'МЫ ', 'АРМИЯ ', 'СИЛА ', 'РОССИЯ ',
    'ПОБЕДА ',
  ],
} as const;

const SSSR: Theme = {
  id: 'СССР',
  model: 16,
  rand: 0.2,
  tab1: [
    '🔨', '🔴', '⚙️', '🏭', '📢',
    '⚒️', '🎖️', '🪖', '📕', '🛠️',
    '☭', '🏅', '🎺', '🟥', '⛏️', '🛡️',
  ],
  tab2: [
    'ЛЕНИН ', 'СТАЛИН ', 'ПАРТИЯ ', 'ТРУД ', 'РАБОЧИЕ ',
    'ОКТЯБРЬ ', 'РЕВОЛЮЦИЯ ', 'СССР ', 'СЪЕЗД ', 'ПЯТИЛЕТКА ',
    'МАРКС ', 'ЭНГЕЛЬС ', 'СЛАВА ', 'ПОБЕДА ', 'КОМСОМОЛ ',
    '1917 ',
  ],
} as const;

const KITAY: Theme = {
  id: 'КИТАЙ',
  model: 4096,
  base: 0x4E00,
  rand: 0.95,
  lang: 'zh-CN',
} as const;

const BUKHAYU: Theme = {
  id: 'БУХАЮ',
  model: 16,
  rand: 0.5,
  tab1: [
    'где ', 'блядь ', 'сука ', 'ты ', 'заебал ',
    'бухаю ', 'ответь ', 'ну ', 'пиздец ', 'деньги ',
    'урод ', 'отдай ', 'верни ', 'говно ', 'обещал ',
    'ненавижу ',
  ],
  tab2: [
    'чё ', 'нахуй ', 'давай ', 'пошёл ', 'ёбаный ',
    'хули ', 'мразь ', 'ладно ', 'короче ', 'звони ',
    'падла ', 'реально ', 'бля ', 'тварь ', 'хватит ',
    'гони ',
  ],
} as const;

const PATER: Theme = {
  id: 'PATER',
  model: 64,
  rand: 0.8,
  lang: 'la',
  tab1: [' et ', ' ac ', ', ', ' sed '],
  tab2: ['. Qui ', '. Non ', '? At ', ' — '],
  tab3: (
    'Dominus Deus spiritus sanctus peccator angelus diabolus caelum '
    + 'infernus pax bellum rex sacerdos propheta apostolus fidelis '
    + 'spes caritas gratia misericordia iustitia veritas lux tenebrae '
    + 'vita mors crux sanguis agnus ovis pastor ecclesia '
    + 'resurrectio paenitentia confessio communio benedictio maledictio laudat orat '
    + 'cantat adorat servit regnat salvat condemnat absolvit iudicat '
    + 'creat liberat sanctificat illuminat patitur resurgit ascendit descendit '
    + 'praedicat docet amat timet sperat credit vivit moritur'
  ).split(' '),
} as const;

// 1024 curated single-codepoint emoji from supplementary Unicode blocks.
// No overlap with РОССИЯ or СССР tab1 tokens.
const EMOJI_CHARS: string =
  ''
  + '🌀🌁🌂🌃🌄🌅🌆🌇🌈🌉🌊🌋🌌🌍🌎🌏🌐🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞🌟🌠🌡🌢🌣🌤🌥🌦🌧🌨🌩🌪🌫🌬🌭🌮🌯🌰🌱🌲🌳🌴🌵🌶🌷🌸🌹🌺🌻🌼🌽🌾🌿'
  + '🍀🍁🍂🍃🍄🍅🍆🍇🍈🍉🍊🍋🍌🍍🍎🍏🍐🍑🍒🍓🍔🍕🍖🍗🍘🍙🍚🍛🍜🍝🍞🍟🍠🍡🍢🍣🍤🍥🍦🍧🍨🍩🍪🍫🍬🍭🍮🍯🍰🍱🍲🍳🍴🍵🍶🍷🍸🍹🍺🍻🍼🍽🍾🍿'
  + '🎀🎁🎂🎃🎄🎅🎆🎇🎈🎉🎊🎋🎌🎍🎎🎏🎐🎑🎒🎓🎔🎕🎗🎘🎙🎚🎛🎜🎝🎞🎟🎠🎡🎢🎣🎤🎥🎦🎧🎨🎩🎪🎫🎬🎭🎮🎯🎰🎱🎲🎳🎴🎵🎶🎷🎸🎹🎻🎼🎽🎾🎿🏀🏁'
  + '🏂🏃🏄🏆🏇🏈🏉🏊🏋🏌🏍🏎🏏🏐🏑🏒🏓🏔🏕🏖🏗🏘🏙🏚🏛🏜🏝🏞🏟🏠🏡🏢🏣🏤🏥🏦🏧🏨🏩🏪🏫🏬🏮🏯🏰🏱🏲🏳🏴🏵🏶🏷🏸🏹🏺🐀🐁🐂🐃🐄🐅🐆🐇🐈'
  + '🐉🐊🐋🐌🐍🐎🐏🐐🐑🐒🐓🐔🐕🐖🐗🐘🐙🐚🐛🐜🐝🐞🐟🐠🐡🐢🐣🐤🐥🐦🐧🐨🐩🐪🐫🐬🐭🐮🐯🐰🐱🐲🐳🐴🐵🐶🐷🐸🐹🐺🐻🐼🐽🐾🐿👀👁👂👃👄👅👆👇👈'
  + '👉👋👌👍👎👐👑👒👓👔👕👖👗👘👙👚👛👜👝👞👟👠👡👢👣👤👥👦👧👨👩👪👫👬👭👮👯👰👱👲👳👴👵👶👷👸👹👺👻👼👽👾👿💀💁💂💃💄💅💆💇💈💉💊'
  + '💋💌💍💎💏💐💑💒💓💔💕💖💗💘💙💚💛💜💝💞💟💠💡💢💣💤💥💦💧💨💩💫💬💭💮💰💱💲💳💴💵💶💷💸💹💺💻💼💽💾💿📀📁📂📃📄📅📆📇📈📉📊📋📌'
  + '📍📎📏📐📑📒📓📔📖📗📘📙📚📛📜📝📞📟📠📡📣📤📥📦📧📨📩📪📫📬📭📮📯📰📱📲📳📴📵📶📷📸📹📺📻📼📽📾📿🔀🔁🔂🔃🔄🔅🔆🔇🔈🔉🔊🔋🔌🔍🔎'
  + '🔏🔐🔑🔒🔓🔔🔕🔖🔗🔘🔙🔚🔛🔜🔝🔞🔟🔠🔡🔢🔣🔤🔦🔧🔩🔪🔫🔬🔭🔮🔯🔰🔱🔲🔳🔵🔶🔷🔸🔹🔺🔻🔼🔽🔾🔿🕀🕁🕂🕃🕄🕅🕆🕇🕈🕉🕊🕋🕌🕍🕎🕏🕐🕑'
  + '🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🕜🕝🕞🕟🕠🕡🕢🕣🕤🕥🕦🕧🕨🕩🕪🕫🕬🕭🕮🕯🕰🕱🕲🕳🕴🕵🕶🕷🕸🕹🕺🕻🕼🕽🕾🕿🖀🖁🖂🖃🖄🖅🖆🖇🖈🖉🖊🖋🖌🖍🖎🖏🖐🖑'
  + '🖒🖓🖔🖕🖖🖗🖘🖙🖚🖛🖜🖝🖞🖟🖠🖡🖢🖣🖤🖥🖦🖧🖨🖩🖪🖫🖬🖭🖮🖯🖰🖱🖲🖳🖴🖵🖶🖷🖸🖹🖺🖻🖼🖽🖾🖿🗀🗁🗂🗃🗄🗅🗆🗇🗈🗉🗊🗋🗌🗍🗎🗏🗐🗑'
  + '🗒🗓🗔🗕🗖🗗🗘🗙🗚🗛🗜🗝🗞🗟🗠🗡🗢🗣🗤🗥🗦🗧🗨🗩🗪🗫🗬🗭🗮🗯🗰🗱🗲🗳🗴🗵🗶🗷🗸🗹🗺🗻🗼🗽🗾🗿😀😁😂😃😄😅😆😇😈😉😊😋😌😍😎😏😐😑'
  + '😒😓😔😕😖😗😘😙😚😛😜😝😞😟😠😡😢😣😤😥😦😧😨😩😪😫😬😭😮😯😰😱😲😳😴😵😶😷😸😹😺😻😼😽😾😿🙀🙁🙂🙃🙄🙅🙆🙇🙈🙉🙊🙌🙍🙎🚁🚂🚃🚄'
  + '🚅🚆🚇🚈🚉🚊🚋🚌🚍🚎🚏🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🚚🚛🚜🚝🚞🚟🚠🚡🚢🚣🚤🚥🚦🚧🚨🚪🚫🚬🚭🚮🚯🚰🚱🚲🚳🚴🚵🚶🚷🚸🚹🚺🚻🚼🚽🚾🚿🛀🛁🛂🛃🛄🛅'
  + '🛆🛇🛈🛉🛊🛋🛌🛍🛎🛏🛐🛑🛒🛓🛔🛕🛖🛗🛘🛙🛚🛛🛜🛝🛞🛟🛢🛣🛤🛥🛦🛧🛨🛩🛪🛫🛬🛭🛮🛯🛰🛱🛲🛳🛴🛵🛶🛷🛸🛹🛺🛻🛼🛽🛾🛿🤀🤁🤂🤃🤄🤅🤆🤇'
  + '🤈🤉🤊🤋🤌🤍🤎🤏🤐🤑🤒🤓🤔🤕🤖🤗🤘🤙🤚🤛🤜🤝🤞🤟🤠🤡🤢🤣🤤🤥🤦🤧🤨🤩🤪🤫🤬🤭🤮🤯🤰🤱🤲🤳🤴🤵🤶🤷🤸🤹🤺🤻🤼🤽🤾🤿🥀🥁🥂🥃🥄🥅🥆🥇';

const EMOJI: Theme = {
  id: '🙂',
  model: 1024,
  rand: 0.7,
  lang: 'en',
  chars: EMOJI_CHARS,
  sep: [' ', '', ' ', ''],
} as const;

const HEX: Theme = {
  id: 'hex',
  model: 0,
  rand: 0,
} as const;

/** All themes in detection priority order (hex MUST be last). */
export const THEMES: readonly Theme[] = [KITAY, PATER, BOZHE, BUKHAYU, ROSSIYA, SSSR, EMOJI, HEX] as const;

/** Theme lookup by ID. */
export const THEME_MAP: ReadonlyMap<ThemeId, Theme> = new Map(THEMES.map(t => [t.id, t]));
