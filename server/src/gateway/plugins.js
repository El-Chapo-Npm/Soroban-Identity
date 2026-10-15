const plugins = new Map();

function registerPlugin(name, plugin) {
  if (!name || typeof name !== 'string') {
    throw new Error('Plugin name must be a non-empty string');
  }
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin must be an object');
  }
  const entry = {
    name,
    enabled: plugin.enabled !== false,
    before: typeof plugin.before === 'function' ? plugin.before : null,
    after: typeof plugin.after === 'function' ? plugin.after : null,
    description: plugin.description || '',
  };
  plugins.set(name, entry);
  return entry;
}

function unregisterPlugin(name) {
  return plugins.delete(name);
}

function getPlugin(name) {
  return plugins.get(name) || null;
}

function enablePlugin(name) {
  const plugin = plugins.get(name);
  if (!plugin) {
    return false;
  }
  plugin.enabled = true;
  return true;
}

function disablePlugin(name) {
  const plugin = plugins.get(name);
  if (!plugin) {
    return false;
  }
  plugin.enabled = false;
  return true;
}

function listPlugins() {
  return Array.from(plugins.values()).map((plugin) => ({
    name: plugin.name,
    enabled: plugin.enabled,
    description: plugin.description,
    hasBefore: plugin.before !== null,
    hasAfter: plugin.after !== null,
  }));
}

function getEnabledPlugins() {
  return Array.from(plugins.values()).filter((plugin) => plugin.enabled);
}

async function runBeforeHooks(context) {
  const results = [];
  for (const plugin of getEnabledPlugins()) {
    if (plugin.before) {
      results.push(await plugin.before(context));
    }
  }
  return results;
}

async function runAfterHooks(context) {
  const results = [];
  for (const plugin of getEnabledPlugins()) {
    if (plugin.after) {
      results.push(await plugin.after(context));
    }
  }
  return results;
}

function clearPlugins() {
  plugins.clear();
}

module.exports = {
  registerPlugin,
  unregisterPlugin,
  getPlugin,
  enablePlugin,
  disablePlugin,
  listPlugins,
  getEnabledPlugins,
  runBeforeHooks,
  runAfterHooks,
  clearPlugins,
};