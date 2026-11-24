const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(process.argv[2] ?? join(__dirname, '..'));
const simplified = join(root, 'dicts');
const traditional = join(root, 'dicts_tw');

function dictionaryNames(directory) {
    return new Set(readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name));
}

function dictionaryKeys(filename) {
    const content = readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
    const dictionary = JSON.parse(content);
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
        throw new Error('Expected a JSON object in ' + filename);
    }
    return new Set(Object.keys(dictionary));
}

const simplifiedFiles = dictionaryNames(simplified);
const traditionalFiles = dictionaryNames(traditional);
let differences = 0;

for (const name of [...new Set([...simplifiedFiles, ...traditionalFiles])].sort()) {
    if (!simplifiedFiles.has(name) || !traditionalFiles.has(name)) {
        const missing = simplifiedFiles.has(name) ? 'dicts_tw' : 'dicts';
        console.error(missing + '/' + name + ' is missing');
        differences += 1;
        continue;
    }

    const scKeys = dictionaryKeys(join(simplified, name));
    const tcKeys = dictionaryKeys(join(traditional, name));
    for (const key of [...new Set([...scKeys, ...tcKeys])].sort()) {
        if (scKeys.has(key) && tcKeys.has(key)) continue;
        const missing = scKeys.has(key) ? 'dicts_tw' : 'dicts';
        console.error(missing + '/' + name + ' is missing key ' + JSON.stringify(key));
        differences += 1;
    }
}

if (!simplifiedFiles.size && !traditionalFiles.size) {
    throw new Error('No JSON dictionaries found in ' + root);
}
if (differences) {
    console.error('Found ' + differences + ' dictionary differences.');
    process.exitCode = 1;
} else {
    console.log('All dictionaries are perfectly aligned!');
}
