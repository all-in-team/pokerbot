/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — never bundle it for the client/server build.
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    // The engine uses explicit ".js" specifiers (NodeNext/ESM-correct so it runs
    // under tsx/node). Let webpack resolve those to the real ".ts" sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
