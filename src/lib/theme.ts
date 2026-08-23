export const THEME_STORAGE_KEY = 'solint-theme';

export type ThemePreference = 'light' | 'dark';

/**
 * Script inline executado antes da hidratacao para aplicar o tema salvo
 * e evitar o flash de tema errado no primeiro render.
 */
export const themeBootstrapScript = `
(function(){
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.dataset.theme = stored;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch (error) {
    // localStorage indisponivel (modo privativo): mantem o tema claro padrão.
  }
})();
`;
