const assert = require("assert");
const {
  normalizePostUrl,
  extractShortcode,
  splitDuplicates,
  levenshtein,
} = require("../src/bot/comands/giveaway");

function testNormalizePostUrl() {
  assert.strictEqual(
    normalizePostUrl("instagram.com/p/DYWRd2qM6k-/"),
    "https://instagram.com/p/DYWRd2qM6k-/"
  );
  assert.strictEqual(
    normalizePostUrl("https://www.instagram.com/p/DYWRd2qM6k-/?img_index=1"),
    "https://www.instagram.com/p/DYWRd2qM6k-/?img_index=1"
  );

  assert.throws(() => normalizePostUrl("not-a-url"));
  assert.throws(() => normalizePostUrl("https://google.com/p/DYWRd2qM6k-/"));
}

function testExtractShortcode() {
  assert.strictEqual(extractShortcode("https://instagram.com/p/DYWRd2qM6k-/"), "DYWRd2qM6k-");
  assert.strictEqual(extractShortcode("https://www.instagram.com/p/A1-B2_C3/"), "A1-B2_C3");
  assert.strictEqual(extractShortcode("https://instagram.com/p/shortcode"), "shortcode");
  assert.strictEqual(extractShortcode("invalid-url"), null);
}

function testSplitDuplicates() {
  const comments = [
    { sender: "user1", text: "Hello" },
    { sender: "user2", text: "Hi" },
    { sender: "user1", text: "Hello" }, // Duplicate by sender and text
    { sender: "user1", text: "Hello " }, // Unique because of space and lowercase conversion? Let's check: key uses .trim().toLowerCase(), so "Hello " is trimmed to "hello". Thus it is a duplicate!
    { sender: "user1", text: "Different text" }, // Unique text by same sender
  ];

  const { unique, duplicates } = splitDuplicates(comments);

  assert.strictEqual(unique.length, 3);
  assert.strictEqual(duplicates.length, 2);

  assert.deepStrictEqual(unique, [
    { sender: "user1", text: "Hello" },
    { sender: "user2", text: "Hi" },
    { sender: "user1", text: "Different text" },
  ]);
}

function testLevenshtein() {
  assert.strictEqual(levenshtein("hello", "hello", 3), 0);
  assert.strictEqual(levenshtein("hello", "helo", 3), 1);
  assert.strictEqual(levenshtein("hello", "hell", 3), 1);
  assert.strictEqual(levenshtein("hello", "world", 3), 4); // maxDistance + 1 because diff is 4
}

async function run() {
  testNormalizePostUrl();
  testExtractShortcode();
  testSplitDuplicates();
  testLevenshtein();
  console.log("Giveaway utility tests passed successfully!");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
