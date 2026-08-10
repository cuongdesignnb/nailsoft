const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
const appReact = require.resolve("react", { paths: [projectRoot] });
const appReactDom = require.resolve("react-dom", { paths: [projectRoot] });

// Workspace packages are symlinked by pnpm. Keep React, React DOM and React
// Native on the consuming app's runtime path so hooks use one dispatcher in
// Expo Web and native bundles alike.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react") return { filePath: appReact, type: "sourceFile" };
  if (moduleName === "react-dom") return { filePath: appReactDom, type: "sourceFile" };
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
