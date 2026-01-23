<p>
  <img 
    src="https://raw.githubusercontent.com/IndokuDev/IndokuDev-all-Logo/refs/heads/main/favicon.png" 
    height="40" 
    alt="SatsetJS"
  />
  <img src="https://readme-typing-svg.herokuapp.com?font=segoe+ui&weight=900&pause=1000&color=F7F7F7&background=FFFFFF00&repeat=false&width=100&height=30&lines=So+much+features%3F;Fullstack%3F;Speed%3F;Light%3F;SatsetJS" alt="Typing SVG" />
</p>

<p>
  <b>The ultra-fast React framework + build tool for people who hate complexity.</b><br/>
  SSR • SSG • ISR • File-based Routing • API Routes • Middleware • RSC • Esbuild
</p>

<p>
  <!-- Badges -->
  <a href="https://github.com/satsetjs/satsetjs">
    <img alt="GitHub Repo" src="https://img.shields.io/badge/github-SatsetJS-blue?logo=github" />
  </a>
  <a href="https://www.npmjs.com/package/satsetjs">
    <img alt="NPM" src="https://img.shields.io/badge/NPM-SatsetJS-blue?logo=NPM" />
  </a>
  <a href="https://satsetjs.dev/docs">
    <img alt="Docs" src="https://img.shields.io/badge/Docs-Read%20Now?logo=readthedocs&logoColor=white" />
  </a>
  <a href="https://satsetjs.dev/discord">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-Join?&logo=discord&logoColor=white" />
  </a>
</p>

---

## ✨ What is SatsetJS?

**SatsetJS** is a **framework + build tool** designed for developers who want to ship React apps **fast** without dealing with annoying setup.

It’s built to feel *minimal*, *clean*, and *instant* — powered by **Esbuild** for speed.

---

## 🔥 Key Features

<table>
  <tr>
    <td width="50%" valign="top">

### 🧠 Framework Features
- ✅ **Server Side Rendering (SSR)**
- ✅ **Static Site Generation (SSG)**
- ✅ **Incremental Static Regeneration (ISR)**
- ✅ **File-based Routing**
- ✅ **Built-in API Routes**
- ✅ **Middleware Support**
- ✅ **Automatic Code Splitting**
- ✅ **SEO Friendly by Default**
- ✅ **App Router (React Server Components)**

    </td>
    <td width="50%" valign="top">

### ⚡ Build Tool Features
- 🚀 **Extremely Fast Cold Server Start**
- ⚡ **Instant Hot Module Replacement (HMR)**
- 🧩 **Esbuild Dev Server**
- 🏗️ **Esbuild-based Production Build**
- 📦 **Optimized Dependency Pre-bundling**
- 🟦 **TypeScript + JSX Support**
- 🪶 **Lightweight & Minimalist**
- 🔧 **Flexible Configuration**
- 🌍 **Framework Agnostic** *(for now: React only)*

    </td>
  </tr>
</table>

---

## 📦 Installation

> Requires **Node.js >= 18**

```
bash
npm i -g satsetjs
or use npx:

bash
Copy code
npx satsetjs create my-app
🚀 Quick Start
Create a project:

bash
Copy code
satsetjs create my-app
cd my-app
Run dev server:

bash
Copy code
satsetjs dev
Build for production:

bash
Copy code
satsetjs build
Start production server:

bash
Copy code
satsetjs start
```
🗂️ Project Structure
SatsetJS uses file-based routing, so your project stays simple:
```
my-app/
  src/
    page.tsx              → /
    about/
      page.tsx            → /about
    blog/
    [slug]/
      page.tsx          → /blog/:slug
    api/
      hello.ts              → /api/hello
  satset.config.ts
  package.json
```
🧭 Routing (File-based)
Example: src/page.tsx
```
export default function Page() {
  return (
    <main>
      <h1>Welcome to SatsetJS ⚡</h1>
      <p>Ship fast. Stay sane.</p>
    </main>
  )
}
```
Dynamic routes:
src/blog/[slug]/page.tsx → /blog/:slug

🧱 API Routes
Example: src/api/route.ts
```
export async function GET() {
  return new Response(JSON.stringify({ message: "Hello from SatsetJS API ⚡" }), {
    headers: { "Content-Type": "application/json" },
  })
}
```
Then hit:
GET /api/hello

🛡️ Middleware
Example: src/middleware.ts
```
export function middleware(req: Request) {
  // example: add headers, auth, redirects, etc.
  return req
}
```
🧊 SSR / SSG / ISR (Concept)
SatsetJS supports:

SSR for dynamic pages

SSG for fast static output

ISR to refresh static pages without rebuilding everything

Docs coming soon: https://satsetjs.dev/docs/rendering

⚙️ Configuration
Create: satset.config.ts
```
import { defineConfig } from 'satset-react';

export default defineConfig({
  server: {
    host: true,
    port: 3000,
  },
  assets: {
    favicon: '/favicon.png',
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});

```
✅ Why SatsetJS?
Because you want:

Next-level speed ✅

Not a 300-file config tutorial ✅

Modern React routing + RSC support ✅

SEO-ready SSR/SSG/ISR ✅

Build tool included ✅

🧪 Scripts
Common commands:

```
satsetjs dev      # start dev server
satsetjs build    # build production
```
🛣️ Roadmap
 React support

 SSR / SSG / ISR

 App Router (RSC)

 Middleware

 Built-in API routes

 Plugin system

 Framework-agnostic runtime (Vue/Svelte/etc)

 Official adapters (Node, Bun, Deno)

 Edge runtime support

🤝 Contributing
Contributions are welcome.

Open an issue: https://github.com/satsetjs/satsetjs/issues

Submit a PR: https://github.com/satsetjs/satsetjs/pulls

⭐ Support the Project
If SatsetJS helps you ship faster:

⭐ Star the repo

🐦 Share it

🧠 Contribute

<p align="center"> <a href="https://github.com/satsetjs/satsetjs/stargazers"> <img src="https://img.shields.io/badge/⭐%20Star%20SatsetJS-on%20GitHub?" /> </a> </p>
📄 License
MIT © SatsetJS

<p align="center"> <sub> Built with ⚡ speed, 🧠 sanity, and 🧱 clean architecture. </sub> </p>
