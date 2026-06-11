const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "../..");
const config = readPlatformConfig();

module.exports = {
  appId: config.desktop.appId,
  productName: config.desktop.productName,
  artifactName: config.desktop.artifactName,
  asar: true,
  npmRebuild: false,
  directories: {
    output: "../../dist/desktop"
  },
  files: [
    "dist/**/*",
    "assets/**/*",
    "package.json",
    "browsers.json"
  ],
  extraResources: [
    { from: "../../apps/web/dist", to: "web" },
    { from: "../../cases", to: "seed/cases" },
    { from: "../../.env.example", to: "seed/.env.example" },
    { from: "../../platform.config.json", to: "seed/platform.config.json" },
    { from: ".generated/seed-manifest.json", to: "seed/seed-manifest.json" }
  ],
  win: {
    icon: "assets/icon.ico",
    signAndEditExecutable: false,
    target: ["nsis", "msi", "portable", "dir"]
  },
  mac: {
    identity: null,
    category: "public.app-category.developer-tools",
    target: ["dmg", "pkg", "zip"]
  },
  linux: {
    icon: "assets/icon.png",
    category: "Development",
    maintainer: config.desktop.maintainer,
    target: ["AppImage", "deb", "rpm", "tar.gz"]
  },
  nsis: {
    artifactName: "${productName}-${version}-win-${arch}-setup.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true
  },
  msi: {
    artifactName: "${productName}-${version}-win-${arch}-installer.${ext}"
  },
  portable: {
    artifactName: "${productName}-${version}-win-${arch}-portable.${ext}"
  },
  dmg: {
    artifactName: "${productName}-${version}-mac-${arch}.${ext}"
  },
  pkg: {
    artifactName: "${productName}-${version}-mac-${arch}-installer.${ext}"
  }
};

function readPlatformConfig() {
  const fallback = {
    desktop: {
      appId: "io.github.dwt-testing.desktop",
      productName: "DWT Testing",
      maintainer: "DWT Testing contributors",
      artifactName: "${productName}-${version}-${os}-${arch}.${ext}"
    }
  };
  const configPath = path.resolve(rootDir, "platform.config.json");
  if (!fs.existsSync(configPath)) {
    return fallback;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    desktop: {
      appId: raw.desktop?.appId || fallback.desktop.appId,
      productName: raw.desktop?.productName || raw.app?.productName || fallback.desktop.productName,
      maintainer: raw.desktop?.maintainer || fallback.desktop.maintainer,
      artifactName: raw.desktop?.artifactName || fallback.desktop.artifactName
    }
  };
}
