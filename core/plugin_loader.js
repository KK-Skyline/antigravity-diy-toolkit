'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function isSubpath(parentReal, childReal) {
    const prefix = parentReal.endsWith(path.sep) ? parentReal : parentReal + path.sep;
    return childReal.startsWith(prefix);
}

function validateSettingValue(key, value, spec) {
    if (!spec || typeof spec !== 'object') {
        throw new Error(`Invalid schema spec for setting "${key}"`);
    }
    const type = spec.type;
    if (type === 'boolean') {
        if (typeof value !== 'boolean') {
            throw new Error(`Setting "${key}" must be a boolean`);
        }
        return value;
    }
    if (type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`Setting "${key}" must be a finite number`);
        }
        if (typeof spec.min === 'number' && value < spec.min) {
            throw new Error(`Setting "${key}" (${value}) is below min ${spec.min}`);
        }
        if (typeof spec.max === 'number' && value > spec.max) {
            throw new Error(`Setting "${key}" (${value}) exceeds max ${spec.max}`);
        }
        return value;
    }
    if (type === 'enum') {
        if (!Array.isArray(spec.values) || !spec.values.includes(value)) {
            throw new Error(`Setting "${key}" must be one of [${(spec.values || []).join(', ')}]`);
        }
        return value;
    }
    if (type === 'color') {
        if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
            throw new Error(`Setting "${key}" must be a #RRGGBB hex color`);
        }
        return value;
    }
    throw new Error(`Unsupported settingsSchema type "${type}" for "${key}"`);
}

function validatePluginConfig(manifest, rawConfig) {
    const schema = manifest.settingsSchema && typeof manifest.settingsSchema === 'object'
        ? manifest.settingsSchema
        : {};
    const validated = {};
    const input = (rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)) ? rawConfig : {};

    for (const [key, spec] of Object.entries(schema)) {
        if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
            validated[key] = validateSettingValue(key, input[key], spec);
        } else if (Object.prototype.hasOwnProperty.call(spec, 'default')) {
            validated[key] = validateSettingValue(key, spec.default, spec);
        }
    }
    return validated;
}

function discoverPlugins(rootDir) {
    const pluginsDir = path.join(rootDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const pluginsReal = fs.realpathSync(pluginsDir);
    const entries = fs.readdirSync(pluginsReal, { withFileTypes: true });
    const manifests = [];

    for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const dirName = entry.name;
        if (!PLUGIN_ID_RE.test(dirName)) {
            throw new Error(`Illegal plugin directory name "${dirName}"`);
        }

        const dirPath = path.join(pluginsReal, dirName);
        const dirReal = fs.realpathSync(dirPath);
        if (!isSubpath(pluginsReal, dirReal)) {
            throw new Error(`Plugin directory "${dirName}" escapes plugins/ via symlink`);
        }

        const manifestPath = path.join(dirReal, 'plugin.json');
        if (!fs.existsSync(manifestPath)) continue;
        const manifestReal = fs.realpathSync(manifestPath);
        if (!isSubpath(dirReal, manifestReal)) {
            throw new Error(`Plugin manifest for "${dirName}" escapes plugin directory via symlink`);
        }

        const manifest = JSON.parse(fs.readFileSync(manifestReal, 'utf8'));
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            throw new Error(`Invalid plugin.json in "${dirName}"`);
        }
        if (typeof manifest.id !== 'string' || !PLUGIN_ID_RE.test(manifest.id) || manifest.id !== dirName) {
            throw new Error(`Plugin id "${manifest.id}" must match directory name "${dirName}" and /^[a-z0-9][a-z0-9-]{0,63}$/`);
        }

        const indexPath = path.join(dirReal, 'index.js');
        if (!fs.existsSync(indexPath)) {
            throw new Error(`Plugin "${dirName}" is missing index.js`);
        }
        const indexReal = fs.realpathSync(indexPath);
        if (!isSubpath(dirReal, indexReal)) {
            throw new Error(`Plugin index.js for "${dirName}" escapes plugin directory via symlink`);
        }

        manifests.push({
            id: manifest.id,
            name: manifest.name || manifest.id,
            version: manifest.version || '1.0.0',
            layerOrder: typeof manifest.layerOrder === 'number' && Number.isFinite(manifest.layerOrder) ? manifest.layerOrder : 100,
            defaultEnabled: manifest.defaultEnabled !== false,
            requires: Array.isArray(manifest.requires) ? manifest.requires : [],
            conflictsWith: Array.isArray(manifest.conflictsWith) ? manifest.conflictsWith : [],
            settingsSchema: manifest.settingsSchema || {},
            dir: dirReal,
            indexPath: indexReal
        });
    }

    manifests.sort((a, b) => (a.layerOrder - b.layerOrder) || a.id.localeCompare(b.id));
    return manifests;
}

function loadUserPluginConfig(rootDir) {
    const userCfgPath = path.join(rootDir, 'plugins.config.json');
    const exampleCfgPath = path.join(rootDir, 'plugins.config.example.json');
    const targetPath = fs.existsSync(userCfgPath) ? userCfgPath : (fs.existsSync(exampleCfgPath) ? exampleCfgPath : null);
    if (!targetPath) return { enabled: {}, settings: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        return {
            enabled: (parsed?.enabled && typeof parsed.enabled === 'object' && !Array.isArray(parsed.enabled)) ? parsed.enabled : {},
            settings: (parsed?.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) ? parsed.settings : {},
            isUserConfig: targetPath === userCfgPath
        };
    } catch (error) {
        console.warn('[AG-Plugin] Could not read plugin configuration:', error.code || error.name);
        return { enabled: {}, settings: {} };
    }
}

function resolvePlugins(rootDir, cliSelection = {}) {
    const manifests = discoverPlugins(rootDir);
    const byId = new Map(manifests.map(m => [m.id, m]));
    const fileCfg = loadUserPluginConfig(rootDir);

    const enabledSet = new Set();
    for (const m of manifests) {
        const modeDefault = cliSelection.defaultEnable?.includes(m.id);
        const hasFileOverride = Object.hasOwn(fileCfg.enabled, m.id) && (fileCfg.isUserConfig || !modeDefault);
        const fileEnabled = hasFileOverride ? Boolean(fileCfg.enabled[m.id]) : modeDefault || m.defaultEnabled;
        if (fileEnabled) enabledSet.add(m.id);
    }

    const availableIds = manifests.map(m => m.id).join(', ');
    if (Array.isArray(cliSelection.enable)) {
        for (const id of cliSelection.enable) {
            if (!byId.has(id)) {
                throw new Error(`Unknown plugin "${id}" in --enable. Available plugins: [${availableIds}]`);
            }
            enabledSet.add(id);
        }
    }
    if (Array.isArray(cliSelection.disable)) {
        for (const id of cliSelection.disable) {
            if (!byId.has(id)) {
                throw new Error(`Unknown plugin "${id}" in --disable. Available plugins: [${availableIds}]`);
            }
            enabledSet.delete(id);
        }
    }

    // Validate conflicts and dependencies among enabled plugins
    for (const id of enabledSet) {
        const m = byId.get(id);
        for (const dep of m.requires) {
            if (!byId.has(dep) || !enabledSet.has(dep)) {
                throw new Error(`Plugin "${id}" requires "${dep}", which is not enabled`);
            }
        }
        for (const conflict of m.conflictsWith) {
            if (enabledSet.has(conflict)) {
                throw new Error(`Plugin "${id}" conflicts with "${conflict}"`);
            }
        }
    }

    const active = [];
    const allConfigs = {};
    for (const m of manifests) {
        if (!enabledSet.has(m.id)) continue;
        const mergedRaw = {
            ...(fileCfg.settings[m.id] || {}),
            ...((cliSelection.settings && cliSelection.settings[m.id]) || {})
        };
        const validated = validatePluginConfig(m, mergedRaw);
        allConfigs[m.id] = validated;
        active.push({
            manifest: m,
            config: validated,
            module: require(m.indexPath)
        });
    }

    return { manifests, active, allConfigs };
}

module.exports = {
    PLUGIN_ID_RE,
    validateSettingValue,
    validatePluginConfig,
    discoverPlugins,
    loadUserPluginConfig,
    resolvePlugins
};
