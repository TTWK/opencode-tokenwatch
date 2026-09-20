// v1.18 无头冒烟验证：node-pty 驱动 opencode (1.18.26)，输入 /usage 并回车。
const os = require("os");
const path = require("path");
const pty = require("node-pty");

const ANSI = /(\x1b\[[0-9;?]*[A-Za-z])|(\x1b\][^\x07\x1b]*(\x07|\x1b\\)?)|(\x1b[PX^_][^\x1b]*\x1b\\)|(\x1b[=>NOPc78])|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const strip = (s) => s.replace(ANSI, "");

const term = pty.spawn("cmd.exe", ["/c", "opencode"], {
  name: "xterm-256color",
  cols: 120,
  rows: 34,
  cwd: path.join(os.homedir()),
  env: process.env,
});

let buf = "";
term.onData((d) => { buf += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    await sleep(20000);
    let v = strip(buf);
    console.log("BOOT chars:", v.length, "| markers:",
      ["opencode", "Ask", "token", "session", "New"].filter((k) => v.toLowerCase().includes(k.toLowerCase())));

    term.write("/usage");
    await sleep(3000);
    v = strip(buf);
    console.log("COMPLETION usage:", /usage/.test(v), "| TokenWatch:", /TokenWatch/.test(v));
    console.log("TAIL_AFTER_TYPE:", JSON.stringify(v.slice(-600)));

    term.write("\r");
    await sleep(6000);
    v = strip(buf);
    const hits = ["HTML", "JSON"].filter((k) => v.includes(k)).length;
    console.log("MENU_HITS:", hits, "/2");
    console.log("TAIL_AFTER_ENTER:", JSON.stringify(v.slice(-800)));
    console.log("VERDICT:", hits >= 2 ? "PASS" : "CHECK_MANUALLY");
  } catch (e) {
    console.error("ERR:", e);
  } finally {
    try { term.kill(); } catch {}
    setTimeout(() => process.exit(0), 500);
  }
})();
