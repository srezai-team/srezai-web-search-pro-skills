#!/usr/bin/env node
// build-skills-zip.mjs — воспроизводимая сборка skills.zip из репозитория пакета
// навыков srezai (тот, что человек ставит `npx skills add`).
//
// Зачем: /skills.zip на сайте годами лежал статикой, собранной руками, и к
// 26.11.2026 отстал на две мажорные версии (6 навыков 0.4.x против 10 навыков
// 0.6.3). Скрипт заменяет «собрал и забыл» на шаг релиза: состав архива целиком
// выводится из пакета, версия сверяется с ожидаемой, а распакованное содержимое
// проверяется обратным чтением zip.
//
// Что кладём в архив (корень):
//   skills/**        — десять навыков: SKILL.md + references/*
//   manifest.json    — машинный индекс пакета (версия, состав, sha256 скиллов)
//   VERSION          — версия набора
//   SHA256SUMS.txt   — контрольные суммы всего, что лежит в архиве (генерируем)
//   README.md        — как ставить
//   LICENSE, NOTICE  — Apache-2.0 требует класть их вместе с копией
//
// Зависимостей нет намеренно: сборка идёт и в node:22-alpine (образ сайта), и на
// ubuntu-раннере GitHub Actions, где python3/zip могут отсутствовать. Zip
// пишется напрямую: имена сортированы, время файлов фиксировано (1980-01-01),
// deflate level 9 — повторная сборка из того же пакета даёт тот же файл.
//
// Использование:
//   node build-skills-zip.mjs --src <путь-к-пакету> --expect <версия> \
//        [--out skills.zip] [--check]
//   node build-skills-zip.mjs --verify-archive <skills.zip> [--expect <версия>]
//
// --check            ничего не пишет: падает, если --out отсутствует или
//                    отличается по составу/содержимому от пакета (CI-гейт
//                    «архив не отстал от версии»).
// --verify-archive   проверяет готовый zip (например, скачанный релизный ассет).
//
// --expect обязателен для сборки: это и есть «ожидаемая версия» из сайта/тега,
// с которой сверяется VERSION пакета. Совпадение с VERSION внутри пакета
// проверять бессмысленно (файлы всегда согласованы сами с собой).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, lstatSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { inflateRawSync, deflateRawSync } from "node:zlib";

const ROOT_FILES = ["manifest.json", "VERSION", "README.md", "LICENSE", "NOTICE"];
const PLUGIN_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
];
// Фиксированная дата внутри zip: 1980-01-01 00:00:00, минимальная для формата.
const DOS_DATE = (1 << 5) | 1; // день 1, месяц 1, год 1980
const DOS_TIME = 0;
const DEFLATE_LEVEL = 9;

function die(msg) {
  console.error(`build-skills-zip: ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    die(`не читается JSON ${file}: ${e.message}`);
  }
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) die(`симлинк в пакете не допускается: ${full}`);
    if (st.isDirectory()) {
      out.push(...walk(full, base));
    } else if (st.isFile()) {
      out.push(relative(base, full).split(sep).join("/"));
    } else {
      die(`не файл и не каталог: ${full}`);
    }
  }
  return out.sort();
}

// --- crc32 (IEEE), нужен и для записи, и для проверки чтением -------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// --- запись zip ------------------------------------------------------------
// entries: [{ path, data: Buffer }] — уже отсортированы по path.
function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const chunks = [];

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data, { level: DEFLATE_LEVEL });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, name, compressed);
    locals.push({ name, localOffset: offset, localSize: 30 + name.length + compressed.length });
    offset += 30 + name.length + compressed.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by unix, v2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs
    central.writeUInt32LE(locals[locals.length - 1].localOffset, 42);
    centrals.push(central, name);
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// --- чтение zip (проверка собранного/скачанного архива) ---------------------
function readZip(buf) {
  // EOCD — последние 22 байта плюс возможный комментарий до 65535.
  let eocdAt = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) die("в файле нет zip-каталога (EOCD) — это не zip?");
  const count = buf.readUInt16LE(eocdAt + 10);
  const cdOffset = buf.readUInt32LE(eocdAt + 16);
  const entries = [];
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) die(`битый центральный каталог на записи ${i}`);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const path = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) die(`${path}: битый локальный заголовок`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataAt, dataAt + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw);
      } catch (e) {
        die(`${path}: не распаковывается (${e.message}) — архив битый`);
      }
    } else die(`${path}: неподдерживаемый метод сжатия ${method}`);
    if (data.length !== usize) die(`${path}: размер после распаковки ${data.length} != ${usize}`);
    if (crc32(data) !== crc) die(`${path}: CRC не сходится`);
    entries.push({ path, data });
  }
  if (at !== cdOffset + buf.readUInt32LE(eocdAt + 12)) die("хвост центрального каталога не сходится");
  return entries;
}

function sumsText(entries) {
  return (
    entries
      .filter((e) => e.path !== "SHA256SUMS.txt")
      .map((e) => `${sha256(e.data)}  ${e.path}`)
      .sort()
      .join("\n") + "\n"
  );
}

// --- сборка инвентаря из пакета --------------------------------------------
function expectedVersionFromEnv(cli) {
  const tag = process.env.GITHUB_REF_NAME;
  const tagVersion = tag && /^v\d/.test(tag) ? tag.replace(/^v/, "") : null;
  const fromCli = cli.expect ?? process.env.SKILLS_ZIP_EXPECT_VERSION ?? null;
  if (tagVersion && fromCli && tagVersion !== fromCli) {
    die(`тег ${tag} не совпадает с ожидаемой версией ${fromCli}`);
  }
  return tagVersion ?? fromCli;
}

function buildInventory(pkgDir, expectVersion) {
  if (!existsSync(join(pkgDir, "manifest.json"))) {
    die(`в ${pkgDir} нет manifest.json — --src должен указывать на корень пакета навыков`);
  }
  const manifest = readJson(join(pkgDir, "manifest.json"));
  const version = readFileSync(join(pkgDir, "VERSION"), "utf8").trim();
  if (!version) die("VERSION пустой");
  if (manifest.version !== version) {
    die(`версия пакета расходится: VERSION=${version}, manifest.json=${manifest.version}`);
  }
  if (!expectVersion) die("нужен --expect <версия>: это ожидаемая версия из сайта или тега");
  if (version !== expectVersion) {
    die(`версия пакета ${version} не совпадает с ожидаемой ${expectVersion}`);
  }
  for (const rel of PLUGIN_MANIFESTS) {
    const file = join(pkgDir, rel);
    if (!existsSync(file)) continue;
    const doc = readJson(file);
    if (doc.version && doc.version !== version) {
      die(`${rel}: версия ${doc.version} != ${version}`);
    }
  }

  const skillsDir = join(pkgDir, "skills");
  if (!existsSync(skillsDir)) die(`в ${pkgDir} нет каталога skills/`);
  const skillDirs = readdirSync(skillsDir)
    .filter((n) => statSync(join(skillsDir, n)).isDirectory())
    .sort();
  const manifestSkills = Array.isArray(manifest.skills) ? manifest.skills : [];
  const declared = manifest.counts?.skills;
  if (declared !== undefined && declared !== skillDirs.length) {
    die(`manifest.counts.skills=${declared}, а в skills/ ${skillDirs.length} навыков`);
  }
  if (manifestSkills.length !== skillDirs.length) {
    die(`в manifest.skills ${manifestSkills.length}, а в skills/ ${skillDirs.length} — пакет перегенерировать`);
  }
  for (const skill of manifestSkills) {
    const name = String(skill.path ?? "").replace(/^\.\/skills\//, "");
    if (!name || name.includes("/") || name.includes("..")) die(`manifest.skills: странный path ${skill.path}`);
    if (!skillDirs.includes(name)) die(`manifest.skills: ${name} нет в skills/`);
    const skillMd = join(skillsDir, name, "SKILL.md");
    if (!existsSync(skillMd)) die(`${name}: нет SKILL.md`);
    const actual = sha256(readFileSync(skillMd));
    if (skill.sha256 && skill.sha256 !== actual) {
      die(`${name}: sha256 SKILL.md не совпадает с manifest.json — перегенерировать пакет`);
    }
  }

  const files = walk(skillsDir, pkgDir);
  const entries = [];
  for (const rel of files) {
    const data = readFileSync(join(pkgDir, rel));
    if (data.length === 0) die(`${rel}: пустой файл`);
    entries.push({ path: rel, data });
  }
  for (const rel of ROOT_FILES) {
    const file = join(pkgDir, rel);
    if (!existsSync(file)) die(`в пакете нет ${rel}`);
    entries.push({ path: rel, data: readFileSync(file) });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (entries.some((e) => e.path === "SHA256SUMS.txt")) die("SHA256SUMS.txt не должен приходить из пакета");
  entries.push({ path: "SHA256SUMS.txt", data: Buffer.from(sumsText(entries), "utf8") });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { version, manifest, skillDirs, entries };
}

// --- проверка готового архива ---------------------------------------------
function verifyArchive(zipBuf, { expectVersion = null } = {}) {
  const entries = readZip(zipBuf);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  for (const rel of [...ROOT_FILES, "SHA256SUMS.txt"]) {
    if (!byPath.has(rel)) die(`в архиве нет ${rel}`);
  }
  const version = byPath.get("VERSION").toString("utf8").trim();
  if (expectVersion && version !== expectVersion) {
    die(`архив версии ${version}, ожидалась ${expectVersion}`);
  }
  const manifest = JSON.parse(byPath.get("manifest.json").toString("utf8"));
  if (manifest.version !== version) die(`в архиве manifest.json ${manifest.version} != VERSION ${version}`);
  const manifestSkills = Array.isArray(manifest.skills) ? manifest.skills : [];
  if (manifest.counts && manifest.counts.skills !== manifestSkills.length) {
    die("в архиве manifest.counts.skills не совпадает с длиной manifest.skills");
  }
  for (const skill of manifestSkills) {
    const name = String(skill.path ?? "").replace(/^\.\/skills\//, "");
    const skillMd = byPath.get(`skills/${name}/SKILL.md`);
    if (!skillMd) die(`в архиве нет skills/${name}/SKILL.md`);
    const actual = sha256(skillMd);
    if (skill.sha256 && skill.sha256 !== actual) die(`в архиве ${name}: sha256 не совпадает с manifest.json`);
  }
  // Навыки обязаны присутствовать полностью: каждый файл из manifest-каталога
  // проверять нечем, поэтому сверяем, что набор каталогов совпадает с манифестом.
  const dirs = new Set();
  for (const e of entries) {
    const m = /^skills\/([^/]+)\//.exec(e.path);
    if (m) dirs.add(m[1]);
  }
  for (const skill of manifestSkills) {
    const name = String(skill.path ?? "").replace(/^\.\/skills\//, "");
    if (!dirs.has(name)) die(`в архиве нет каталога skills/${name}/`);
  }
  if (dirs.size !== manifestSkills.length) die(`каталогов навыков ${dirs.size}, в манифесте ${manifestSkills.length}`);
  const recorded = byPath.get("SHA256SUMS.txt").toString("utf8");
  const expectedSums = sumsText(entries);
  if (recorded !== expectedSums) die("SHA256SUMS.txt не совпадает с содержимым архива");
  for (const rel of ["README.md", "LICENSE", "NOTICE"]) {
    if (byPath.get(rel).length === 0) die(`${rel} пустой`);
  }
  return { version, entries, counts: { skills: manifestSkills.length } };
}

function compareWithExisting(existingPath, builtEntries, builtBuf, version) {
  if (!existsSync(existingPath)) die(`--check: архива ${existingPath} нет — сначала собрать`);
  const existingBuf = readFileSync(existingPath);
  let existing;
  try {
    existing = verifyArchive(existingBuf);
  } catch (e) {
    die(`--check: существующий ${existingPath} невалиден: ${e.message}`);
  }
  if (existing.version !== version) {
    die(`--check: архив устарел — в нём версия ${existing.version}, пакет ${version}`);
  }
  const oldMap = new Map(existing.entries.map((e) => [e.path, sha256(e.data)]));
  const newMap = new Map(builtEntries.map((e) => [e.path, sha256(e.data)]));
  const missing = [...newMap.keys()].filter((p) => !oldMap.has(p));
  const extra = [...oldMap.keys()].filter((p) => !newMap.has(p));
  const changed = [...newMap.keys()].filter((p) => oldMap.has(p) && oldMap.get(p) !== newMap.get(p));
  if (missing.length || extra.length || changed.length) {
    const list = (title, items) => (items.length ? `  ${title}: ${items.slice(0, 8).join(", ")}${items.length > 8 ? ` (+${items.length - 8})` : ""}` : "");
    die(
      "--check: архив не совпадает с пакетом — пересобрать\n" +
        [list("нет в архиве", missing), list("лишнее в архиве", extra), list("изменилось", changed)]
          .filter(Boolean)
          .join("\n"),
    );
  }
  // Содержимое совпало; байты могут отличаться только упаковкой. Если байты те
  // же — архив точно воспроизводим, об этом сообщаем отдельно.
  const byteIdentical = existingBuf.equals(builtBuf);
  log(`✓ --check: архив ${existingPath} соответствует пакету ${version} (${newMap.size} файлов${byteIdentical ? ", байт-в-байт" : ", упаковка отличается"})`);
}

// --- CLI -------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { src: ".", out: "skills.zip", check: false, verifyArchive: null, expect: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) die(`после ${arg} нужен аргумент`);
      return v;
    };
    if (arg === "--src") opts.src = next();
    else if (arg === "--out") opts.out = next();
    else if (arg === "--expect") opts.expect = next();
    else if (arg === "--check") opts.check = true;
    else if (arg === "--verify-archive") opts.verifyArchive = next();
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else die(`неизвестный аргумент ${arg} (см. --help)`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    log(
      [
        "build-skills-zip.mjs — собрать skills.zip из пакета навыков",
        "",
        "  --src <dir>            корень пакета навыков (по умолчанию .)",
        "  --expect <version>     ожидаемая версия пакета (обязательна; или SKILLS_ZIP_EXPECT_VERSION)",
        "  --out <file>           куда писать zip (по умолчанию skills.zip)",
        "  --check                не писать, только сверить --out с пакетом (CI-гейт)",
        "  --verify-archive <zip> проверить готовый архив (версию, состав, суммы)",
      ].join("\n"),
    );
    return;
  }

  if (opts.verifyArchive) {
    const buf = readFileSync(resolve(opts.verifyArchive));
    const result = verifyArchive(buf, { expectVersion: opts.expect });
    log(`✓ ${opts.verifyArchive}: версия ${result.version}, навыков ${result.counts.skills}, файлов ${result.entries.length}, sha256 ${sha256(buf)}`);
    if (opts.expect && result.version !== opts.expect) die("недостижимо");
    return;
  }

  const expectVersion = expectedVersionFromEnv(opts);
  const pkgDir = resolve(opts.src);
  const out = resolve(opts.out);
  const { version, skillDirs, entries } = buildInventory(pkgDir, expectVersion);
  const buf = writeZip(entries);
  const zipSha = sha256(buf);

  // Обратное чтение: архив обязан распаковываться и совпадать с пакетом.
  const result = verifyArchive(buf, { expectVersion });
  if (result.entries.length !== entries.length) die("после записи число файлов в архиве изменилось");

  if (opts.check) {
    compareWithExisting(out, entries, buf, version);
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  writeFileSync(`${out}.sha256`, `${zipSha}  ${out.split(sep).pop()}\n`);
  log(
    `✓ ${out}: версия ${version}, навыков ${skillDirs.length}, файлов ${entries.length}, ` +
      `${buf.length} байт, sha256 ${zipSha}`,
  );
  log(`  контрольная сумма записана рядом: ${out}.sha256`);
}

try {
  main();
} catch (e) {
  // Непредвиденное (например, битый zip в --verify-archive) должно давать
  // понятную строку и код 1, а не стектрейс zlib в логе CI.
  die(e instanceof Error ? e.message : String(e));
}
