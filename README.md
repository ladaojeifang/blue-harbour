# 蓝瓷港城 · Three.js 漫游

可在浏览器里自动漫游、自由行走和俯瞰的三维港城。天空、灯光、海面倒影、海岸和坡地植被由 Three.js 实时渲染。`assets` 包含运行所需的两档网格、内嵌贴图和漫游数据。项目可独立运行。

## 本地运行

使用 Node.js 24 和支持 WebGL 2 的浏览器。请在仓库根目录运行下面两条命令。

```sh
npm ci
npm start
```

打开 [本地漫游](http://127.0.0.1:4173/)。如果默认端口已被占用，设置环境变量 `HARBOUR_PORT` 后再启动。

- 自动漫游可以暂停，也可以按地点跳转。
- 自由行走支持 WASD 和鼠标。点击场景锁定鼠标，按 Esc 释放。
- 右上角可切换俯瞰和模型精度。默认加载完整场景。

## 构建与预览

```sh
npm run build
npm run preview:pages
```

打开 [GitHub Pages 子路径预览](http://127.0.0.1:4174/blue-harbour/)。`dist` 是可发布的静态目录。部署工作流会自动生成它。

## 发布到 GitHub Pages

1. 新建一个空的 GitHub 仓库，例如 `blue-harbour`。把本目录的内容推送到仓库根目录的 `main` 分支。完整模型超过 GitHub 的网页单文件上传限制，请使用 Git 推送。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Deploy harbour viewer** 手动运行首次部署。成功后从部署记录打开发布链接。之后推送到 `main` 会自动更新。

[GitHub Pages 发布源设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [GitHub 文件大小限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
