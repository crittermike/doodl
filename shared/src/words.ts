/**
 * The default doodl word list.
 *
 * This list is original to this project: it was written by hand for doodl from
 * everyday English vocabulary, not copied or derived from skribbl.io or any
 * other game's word list. Every entry is a common, concrete noun that a person
 * can plausibly draw in eighty seconds with a mouse.
 *
 * Rooms can supply their own list instead (or in addition) — see
 * `RoomSettings.customWords`.
 */

const RAW_WORDS = [
  // --- Animals ---
  'cat', 'dog', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken', 'duck', 'goose',
  'turkey', 'rabbit', 'mouse', 'rat', 'squirrel', 'deer', 'moose', 'bear', 'wolf', 'fox',
  'lion', 'tiger', 'leopard', 'elephant', 'giraffe', 'zebra', 'hippo', 'rhino', 'monkey', 'gorilla',
  'kangaroo', 'koala', 'panda', 'camel', 'llama', 'donkey', 'bat', 'hedgehog', 'raccoon', 'skunk',
  'beaver', 'otter', 'seal', 'walrus', 'whale', 'dolphin', 'shark', 'octopus', 'squid', 'crab',
  'lobster', 'shrimp', 'jellyfish', 'starfish', 'snail', 'slug', 'worm', 'spider', 'ant', 'bee',
  'wasp', 'butterfly', 'moth', 'beetle', 'ladybug', 'grasshopper', 'cricket', 'dragonfly', 'snake', 'lizard',
  'turtle', 'frog', 'toad', 'crocodile', 'dinosaur', 'penguin', 'owl', 'eagle', 'hawk', 'parrot',
  'flamingo', 'peacock', 'swan', 'pigeon', 'crow', 'woodpecker', 'hummingbird', 'ostrich', 'seahorse', 'fish',

  // --- Food and drink ---
  'apple', 'banana', 'orange', 'lemon', 'lime', 'grapes', 'strawberry', 'blueberry', 'raspberry', 'cherry',
  'peach', 'pear', 'plum', 'pineapple', 'watermelon', 'mango', 'coconut', 'avocado', 'tomato', 'potato',
  'carrot', 'onion', 'garlic', 'pepper', 'cucumber', 'lettuce', 'cabbage', 'broccoli', 'cauliflower', 'corn',
  'peas', 'mushroom', 'pumpkin', 'eggplant', 'bread', 'toast', 'sandwich', 'burger', 'hot dog', 'pizza',
  'taco', 'burrito', 'pasta', 'spaghetti', 'noodles', 'rice', 'soup', 'salad', 'cheese', 'egg',
  'bacon', 'sausage', 'steak', 'sushi', 'popcorn', 'pretzel', 'donut', 'cupcake', 'cake', 'pie',
  'cookie', 'brownie', 'muffin', 'pancake', 'waffle', 'croissant', 'bagel', 'ice cream', 'lollipop', 'candy',
  'chocolate', 'marshmallow', 'honey', 'jam', 'butter', 'milk', 'coffee', 'tea', 'juice', 'soda',

  // --- Around the house ---
  'chair', 'table', 'desk', 'bed', 'sofa', 'lamp', 'mirror', 'clock', 'door', 'window',
  'curtain', 'rug', 'pillow', 'blanket', 'towel', 'soap', 'toothbrush', 'comb', 'razor', 'toilet',
  'bathtub', 'shower', 'sink', 'faucet', 'fridge', 'oven', 'stove', 'microwave', 'toaster', 'kettle',
  'blender', 'pot', 'pan', 'plate', 'bowl', 'cup', 'mug', 'fork', 'knife', 'spoon',
  'chopsticks', 'napkin', 'bottle', 'jar', 'can', 'box', 'basket', 'bucket', 'broom', 'mop',
  'vacuum', 'ladder', 'trash can', 'key', 'lock', 'candle', 'flashlight', 'battery', 'plug', 'fan',
  'shelf', 'drawer', 'cabinet', 'closet', 'hanger', 'stairs', 'fence', 'gate', 'mailbox', 'doorbell',

  // --- Clothing ---
  'shirt', 'sweater', 'jacket', 'coat', 'vest', 'dress', 'skirt', 'pants', 'jeans', 'shorts',
  'socks', 'shoes', 'boots', 'sandals', 'sneakers', 'hat', 'cap', 'crown', 'helmet', 'scarf',
  'gloves', 'mittens', 'belt', 'necktie', 'bow tie', 'glasses', 'sunglasses', 'wristwatch', 'ring', 'necklace',
  'bracelet', 'earring', 'backpack', 'purse', 'wallet', 'umbrella', 'apron', 'pajamas', 'swimsuit', 'slippers',

  // --- Getting around ---
  'car', 'truck', 'bus', 'van', 'taxi', 'bicycle', 'motorcycle', 'scooter', 'skateboard', 'train',
  'tram', 'subway', 'airplane', 'helicopter', 'rocket', 'boat', 'ship', 'sailboat', 'canoe', 'kayak',
  'submarine', 'hot air balloon', 'tractor', 'bulldozer', 'crane', 'ambulance', 'fire truck', 'police car', 'wheelbarrow', 'sled',
  'wagon', 'ferry', 'unicycle', 'tricycle',

  // --- Nature ---
  'tree', 'flower', 'rose', 'tulip', 'sunflower', 'daisy', 'cactus', 'grass', 'leaf', 'branch',
  'seed', 'acorn', 'pinecone', 'palm tree', 'bush', 'vine', 'fern', 'mountain', 'hill', 'volcano',
  'island', 'beach', 'desert', 'forest', 'jungle', 'river', 'lake', 'ocean', 'waterfall', 'cave',
  'cliff', 'canyon', 'rock', 'snow', 'ice', 'iceberg', 'cloud', 'rain', 'rainbow', 'lightning',
  'tornado', 'sun', 'moon', 'star', 'planet', 'comet', 'fire', 'feather', 'shell', 'puddle',

  // --- Buildings and places ---
  'house', 'castle', 'tower', 'lighthouse', 'barn', 'church', 'temple', 'pyramid', 'bridge', 'tunnel',
  'windmill', 'tent', 'igloo', 'treehouse', 'skyscraper', 'hospital', 'school', 'library', 'museum', 'stadium',
  'airport', 'factory', 'farm', 'garage', 'hotel', 'restaurant', 'bakery', 'bank', 'playground', 'park',
  'zoo', 'aquarium', 'cinema',

  // --- Tools and objects ---
  'hammer', 'screwdriver', 'wrench', 'saw', 'drill', 'nail', 'screw', 'pliers', 'axe', 'shovel',
  'rake', 'scissors', 'tape', 'glue', 'rope', 'chain', 'magnet', 'ruler', 'compass', 'telescope',
  'microscope', 'binoculars', 'camera', 'phone', 'computer', 'laptop', 'keyboard', 'monitor', 'printer', 'television',
  'radio', 'speaker', 'headphones', 'microphone', 'remote control', 'calculator', 'book', 'notebook', 'pencil', 'pen',
  'marker', 'crayon', 'eraser', 'paintbrush', 'palette', 'easel', 'envelope', 'stamp', 'newspaper', 'magazine',
  'map', 'globe', 'calendar', 'folder', 'suitcase', 'briefcase', 'lightbulb', 'hourglass', 'thermometer', 'syringe',

  // --- Music ---
  'guitar', 'piano', 'violin', 'cello', 'drum', 'trumpet', 'saxophone', 'flute', 'clarinet', 'harp',
  'banjo', 'accordion', 'tambourine', 'xylophone', 'harmonica',

  // --- Sports, games and toys ---
  'ball', 'soccer ball', 'basketball', 'football', 'baseball', 'tennis racket', 'golf club', 'hockey stick', 'net', 'trophy',
  'medal', 'whistle', 'skis', 'snowboard', 'surfboard', 'kite', 'balloon', 'teddy bear', 'doll', 'robot',
  'puzzle', 'dice', 'chess', 'dominoes', 'yo-yo', 'marbles', 'slingshot', 'swing', 'slide', 'seesaw',
  'trampoline', 'jump rope', 'hula hoop', 'frisbee', 'dartboard', 'bowling pin', 'dumbbell', 'skateboard ramp',

  // --- Make believe ---
  'ghost', 'witch', 'wizard', 'dragon', 'unicorn', 'mermaid', 'fairy', 'alien', 'monster', 'zombie',
  'vampire', 'skeleton', 'pirate', 'ninja', 'knight', 'king', 'queen', 'clown', 'snowman', 'scarecrow',
  'jack-o-lantern', 'gravestone', 'magic wand', 'crystal ball', 'treasure chest', 'anchor', 'sword', 'shield', 'cannon', 'spaceship',

  // --- The human body ---
  'eye', 'ear', 'nose', 'mouth', 'tooth', 'tongue', 'hand', 'finger', 'thumb', 'foot',
  'arm', 'leg', 'knee', 'elbow', 'shoulder', 'hair', 'beard', 'mustache', 'heart', 'brain',
  'bone', 'skull', 'footprint',

  // --- Shapes and symbols ---
  'arrow', 'question mark', 'smiley face', 'gift', 'ribbon', 'flag', 'banner', 'target', 'ladder rung', 'spiral',
  'maze', 'bubble', 'spider web', 'cage', 'hourglass sand', 'checkerboard', 'stop sign', 'traffic light', 'road', 'crosswalk',
];

/**
 * Deduplicated and frozen. Building it through a Set means a stray duplicate in
 * the literal above can never skew the random word draw.
 */
export const DEFAULT_WORDS: readonly string[] = Object.freeze([...new Set(RAW_WORDS)]);

/**
 * Resolve the pool a room should draw from.
 *
 * `customWordsOnly` requires enough custom words to actually run a game; if the
 * list is too short we fall back to including the defaults rather than looping
 * the same four words all night.
 */
export function resolveWordPool(
  customWords: readonly string[],
  customWordsOnly: boolean,
  minCustom: number,
): readonly string[] {
  const custom = customWords.filter((w) => w.trim().length > 0);
  if (custom.length === 0) return DEFAULT_WORDS;
  if (customWordsOnly && custom.length >= minCustom) return Object.freeze([...new Set(custom)]);
  return Object.freeze([...new Set([...custom, ...DEFAULT_WORDS])]);
}

/**
 * Parse a user-supplied word list. Accepts commas and/or newlines as
 * separators, trims, drops empties and collapses internal whitespace.
 */
export function parseWordList(input: string, maxWordLen: number, maxWords: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input.split(/[,\n\r]+/)) {
    const word = raw.trim().replace(/\s+/g, ' ');
    if (!word || word.length > maxWordLen) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= maxWords) break;
  }

  return out;
}
