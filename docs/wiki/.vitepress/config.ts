import { defineConfig } from "vitepress";

const zhTheme = {
  outline: "deep",
  search: { provider: "local" },
  localeLinks: { text: "语言 / Language" },
  nav: [
    { text: "开始使用", link: "/getting-started" },
    { text: "构建与部署", link: "/build-and-deploy" },
    { text: "CLI", link: "/cli" },
    { text: "API", link: "/api" },
    { text: "SDK", link: "/sdk" },
  ],
  sidebar: [
    { text: "概览", items: [{ text: "Wiki 首页", link: "/" }, { text: "架构与核心概念", link: "/architecture" }] },
    {
      text: "使用指南",
      items: [
        { text: "快速开始", link: "/getting-started" },
        { text: "配置模型", link: "/configuration" },
        { text: "CLI 使用手册", link: "/cli" },
        { text: "任意目录调用 CLI 与 SDK", link: "/sdk" },
        { text: "典型工作流", link: "/workflows" },
        { text: "通俗案例：审查一次仓库", link: "/case-study" },
        { text: "Control Center UI 用法", link: "/ui-guide" },
      ],
    },
    {
      text: "服务与扩展",
      items: [
        { text: "本地 API 与 Control Center", link: "/api" },
        { text: "Environment 管理", link: "/environments" },
        { text: "Adapter 开发与安装", link: "/adapters" },
        { text: "DeepSeek Harness 集成", link: "/dsh" },
      ],
    },
    {
      text: "运维参考",
      items: [
        { text: "从源码构建与本地部署", link: "/build-and-deploy" },
        { text: "数据、权限与安全", link: "/security" },
        { text: "故障排查", link: "/troubleshooting" },
      ],
    },
  ],
  footer: { message: "AgentDock 本地优先控制面" },
};

const enTheme = {
  outline: "deep",
  search: { provider: "local" },
  localeLinks: { text: "Language / 语言" },
  nav: [
    { text: "Getting started", link: "/en/getting-started" },
    { text: "Build & deploy", link: "/en/build-and-deploy" },
    { text: "CLI", link: "/en/cli" },
    { text: "API", link: "/en/api" },
    { text: "SDK", link: "/en/sdk" },
  ],
  sidebar: [
    { text: "Overview", items: [{ text: "Wiki home", link: "/en/" }, { text: "Architecture & concepts", link: "/en/architecture" }] },
    {
      text: "User guide",
      items: [
        { text: "Getting started", link: "/en/getting-started" },
        { text: "Configuration", link: "/en/configuration" },
        { text: "CLI reference", link: "/en/cli" },
        { text: "CLI & SDK from any directory", link: "/en/sdk" },
        { text: "Workflows", link: "/en/workflows" },
        { text: "Plain-language case study", link: "/en/case-study" },
        { text: "Control Center UI guide", link: "/en/ui-guide" },
      ],
    },
    {
      text: "Services & extensions",
      items: [
        { text: "Local API & Control Center", link: "/en/api" },
        { text: "Environment management", link: "/en/environments" },
        { text: "Adapter development", link: "/en/adapters" },
        { text: "DeepSeek Harness integration", link: "/en/dsh" },
      ],
    },
    {
      text: "Operations",
      items: [
        { text: "Build & local deployment", link: "/en/build-and-deploy" },
        { text: "Data, permissions & security", link: "/en/security" },
        { text: "Troubleshooting", link: "/en/troubleshooting" },
      ],
    },
  ],
  footer: { message: "AgentDock local-first control plane" },
};

export default defineConfig({
  title: "AgentDock Wiki",
  description: "Usage, build, deployment and development documentation for AgentDock",
  cleanUrls: true,
  locales: {
    root: { label: "简体中文", lang: "zh-CN", link: "/", themeConfig: zhTheme },
    en: { label: "English", lang: "en", link: "/en/", themeConfig: enTheme },
  },
});
