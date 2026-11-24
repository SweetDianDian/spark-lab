import type { ThemeConfig } from 'antd';

/** One component-library theme for the entire learning product. */
export const learningTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2549c8', colorInfo: '#2549c8', colorText: '#242520', colorTextSecondary: '#655f52',
    colorTextDescription: '#655f52', colorTextTertiary: '#736d60', colorTextDisabled: '#817c70',
    colorBgLayout: '#f6f2e6', colorBgContainer: '#fffcf2', colorBgElevated: '#fffcf2', colorBorder: '#c7bea9', colorBorderSecondary: '#d5ccb6',
    borderRadius: 5, fontSize: 15, fontSizeLG: 16, controlHeight: 40,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
    Card: { borderRadiusLG: 6, headerFontSize: 16 },
    Menu: { itemBg: 'transparent', horizontalItemSelectedColor: '#2549c8', itemColor: '#48453c' },
    Modal: { titleFontSize: 20 },
    Tabs: { horizontalItemGutter: 28 },
  },
};
