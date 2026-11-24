import type { ThemeConfig } from 'antd';

/** One component-library theme for the entire learning product. */
export const learningTheme: ThemeConfig = {
  token: {
    colorPrimary: '#4361ee', colorInfo: '#4361ee', colorText: '#253046', colorTextSecondary: '#627086',
    colorTextDescription: '#627086', colorTextTertiary: '#78849a', colorTextDisabled: '#8b95a6',
    colorBgLayout: '#f7f9fc', colorBgContainer: '#ffffff', colorBorder: '#dfe5ee', colorBorderSecondary: '#e5eaf2',
    borderRadius: 10, fontSize: 15, fontSizeLG: 16, controlHeight: 40,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
    Card: { borderRadiusLG: 14, headerFontSize: 16 },
    Menu: { itemBg: 'transparent', horizontalItemSelectedColor: '#4361ee', itemColor: '#627086' },
    Modal: { titleFontSize: 20 },
    Tabs: { horizontalItemGutter: 28 },
  },
};
