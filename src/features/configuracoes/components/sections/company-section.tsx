'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Globe, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CompanyProfile } from '@/core/domain/settings';
import type { Account } from '@/core/domain/user';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { UnsavedChangesBar } from '@/features/configuracoes/components/unsaved-changes-bar';
import { saveCompanyProfileAction, uploadCompanyLogoAction } from '@/app/(workspace)/configuracoes/actions';
import { ALLOWED_LOGO_MIME_TYPES } from '@/core/domain/image-upload';
import {
  CURRENCIES,
  FIRST_DAYS_OF_WEEK,
  LANGUAGES,
  TIMEZONES,
  asCurrency,
  asFirstDayOfWeek,
  asLanguage,
  asTimezone,
} from '@/core/domain/regional-preferences';
import { DATE_FORMATS, asDateFormat } from '@/lib/datetime';
import {
  DOCUMENT_ERROR,
  EMAIL_ERROR,
  PHONE_ERROR,
  formatCompanyDocument,
  formatCompanyPhone,
  isValidCompanyDocument,
  isValidCompanyEmail,
  isValidCompanyPhone,
  maskCompanyPhoneInput,
} from '@/core/domain/company-identity';

interface CompanySectionProps {
  readonly account: Account;
  readonly company: CompanyProfile;
}

/**
 * A classe do campo, com a borda vermelha quando ele está recusado.
 *
 * A string era repetida em oito inputs; agora os três que validam precisam de
 * uma variante, e copiá-la mais três vezes garantiria que a próxima mudança de
 * estilo pegasse uns e esquecesse outros.
 */
/**
 * Os rótulos das preferências regionais.
 *
 * Os valores vêm do domínio (`LANGUAGES`, `TIMEZONES`, …) e só a redação mora
 * aqui. Antes as opções eram escritas à mão no JSX e o servidor as aceitava
 * como texto livre: a tela e a validação eram duas listas sem nada as
 * obrigando a concordar.
 */
const LABELS_IDIOMA: Record<(typeof LANGUAGES)[number], string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (United States)',
  'es-ES': 'Español',
};

const LABELS_FUSO: Record<(typeof TIMEZONES)[number], string> = {
  'America/Sao_Paulo': 'America/Sao_Paulo (GMT-3)',
  'America/Manaus': 'America/Manaus (GMT-4)',
  'America/Noronha': 'America/Noronha (GMT-2)',
  UTC: 'UTC (Padrão Internacional)',
};

const LABELS_MOEDA: Record<(typeof CURRENCIES)[number], string> = {
  BRL: 'BRL (R$ Real brasileiro)',
  USD: 'USD ($ Dólar americano)',
  EUR: 'EUR (€ Euro)',
};

const LABELS_DATA: Record<(typeof DATE_FORMATS)[number], string> = {
  'DD/MM/YYYY': 'DD/MM/AAAA (ex: 26/08/2026)',
  'DD/MM/YY': 'DD/MM/AA (ex: 26/08/26)',
  'YYYY-MM-DD': 'AAAA-MM-DD (ISO 8601)',
  'MM/DD/YYYY': 'MM/DD/AAAA (US)',
};

const LABELS_PRIMEIRO_DIA: Record<(typeof FIRST_DAYS_OF_WEEK)[number], string> = {
  segunda: 'Segunda-feira (Padrão corporativo)',
  domingo: 'Domingo',
};

const campoClasse = (invalido: boolean, mono: boolean): string =>
  cn(
    'h-10 w-full rounded-xl border bg-surface px-3 text-xs text-ink outline-none shadow-2xs focus:ring-2',
    mono && 'font-mono',
    invalido
      ? 'border-red-line/60 focus:border-red-text focus:ring-red-text/20'
      : 'border-line focus:border-brand focus:ring-brand/20',
  );

export function CompanySection({ account, company }: CompanySectionProps) {
  const { show } = useToast();
  const router = useRouter();
  const [isSaving, startTransition] = useTransition();

  /**
   * O formulário parte do que está gravado.
   *
   * Antes cada campo nascia de um literal ('Av. Paulista, 1000…') e o salvar
   * era um `setTimeout` com aviso de sucesso — os dados nunca saíam da memória
   * do navegador. Agora o estado inicial é o do banco, e o vazio aparece vazio
   * em vez de fingir um valor de exemplo.
   */
  const inicial = useMemo(
    () => ({
      tradeName: account.name,
      legalName: company.legalName ?? '',
      // Gravado canônico (E.164 no telefone), exibido legível. Sem isto o campo
      // mostraria `+5511987654321` de volta para quem digitou `(11) 98765-4321`.
      document: formatCompanyDocument(account.document ?? ''),
      email: company.email ?? '',
      phone: formatCompanyPhone(company.phone ?? ''),
      website: company.website ?? '',
      address: company.address ?? '',
      // Pelos normalizadores, e não por `??`: o operador só cobre `undefined`,
      // e a coluna é JSON gravado quando o servidor aceitava texto livre. Um
      // `dateFormat: 'dd/mm/aa'` de uma versão antiga sobreviveria ao `??`,
      // ficaria fora da lista do `<select>` — que renderiza vazio — e faria a
      // gravação inteira ser recusada pelo enum, num campo que a pessoa nem
      // tocou.
      language: asLanguage(company.language),
      timezone: asTimezone(company.timezone),
      currency: asCurrency(company.currency),
      dateFormat: asDateFormat(company.dateFormat),
      firstDayOfWeek: asFirstDayOfWeek(company.firstDayOfWeek),
      brandColor: company.brandColor ?? '#2563EB',
    }),
    [account, company],
  );

  const [form, setForm] = useState(inicial);

  /**
   * O logo é enviado na hora, fora do "Salvar" geral do formulário.
   *
   * Mesmo raciocínio da foto de perfil pessoal: upload de arquivo é, em toda
   * parte da web, uma ação imediata — encaixar isso no fluxo de "salvar
   * pendente / descartar" desta tela criaria um estado estranho de se
   * abandonar.
   */
  const [logoUrl, setLogoUrl] = useState(company.logoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Sempre limpo, mesmo em erro: sem isto, escolher o mesmo arquivo duas
    // vezes seguidas não disparava `onChange` de novo.
    event.target.value = '';
    if (!file) return;

    setLogoError(null);
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.set('logo', file);
      const result = await uploadCompanyLogoAction(formData);

      if (!result.ok) {
        setLogoError(result.error ?? null);
        show({
          tone: 'erro',
          title: 'Não foi possível enviar o logotipo',
          description: result.error ?? 'Tente novamente.',
        });
        return;
      }

      // Prévia imediata a partir do arquivo escolhido — não espera o próximo
      // carregamento da página para a pessoa ver o resultado.
      setLogoUrl(URL.createObjectURL(file));
      show({ tone: 'sucesso', title: 'Logotipo atualizado' });
    } catch {
      setLogoError('Erro ao enviar a imagem.');
      show({ tone: 'erro', title: 'Erro ao enviar a imagem', description: 'Tente novamente.' });
    } finally {
      setUploadingLogo(false);
    }
  };
  useEffect(() => setForm(inicial), [inicial]);

  const set = <K extends keyof typeof inicial>(key: K, value: (typeof inicial)[K]) =>
    setForm((atual) => ({ ...atual, [key]: value }));

  // Compara com o que está gravado, campo a campo: antes só três campos
  // contavam, e editar o endereço não acendia a barra de alterações.
  const dirty = (Object.keys(inicial) as (keyof typeof inicial)[]).some(
    (key) => form[key] !== inicial[key],
  );

  /**
   * Os erros de identificação, calculados a cada render em vez de guardados.
   *
   * Estado separado precisaria ser sincronizado a cada digitação e a cada
   * descarte, e é justamente aí que esse tipo de campo fica com um erro velho
   * na tela depois de já ter sido corrigido. Derivar do formulário elimina a
   * sincronização: se o valor está válido, não há erro para mostrar.
   *
   * Campo vazio não acusa nada — os três são opcionais, e cobrar um telefone de
   * quem só quer trocar o nome fantasia seria inventar uma exigência que o
   * cadastro não tem.
   */
  const erros = {
    document:
      form.document.trim() && !isValidCompanyDocument(form.document) ? DOCUMENT_ERROR : undefined,
    phone: isValidCompanyPhone(form.phone) ? undefined : PHONE_ERROR,
    email: isValidCompanyEmail(form.email) ? undefined : EMAIL_ERROR,
  };
  const temErro = Object.values(erros).some(Boolean);

  const handleSave = () => {
    // A action recusa de todo jeito; parar aqui evita a ida ao servidor e
    // devolve o motivo apontando para o campo, não num aviso genérico.
    if (temErro) {
      show({
        tone: 'erro',
        title: 'Confira os dados institucionais',
        description: erros.document ?? erros.phone ?? erros.email,
      });
      return;
    }

    startTransition(async () => {
      const result = await saveCompanyProfileAction(form);
      if (!result.ok) {
        show({
          tone: 'erro',
          title: 'Falha ao salvar',
          description: result.error ?? 'Verifique os campos e tente novamente.',
        });
        return;
      }

      show({
        tone: 'sucesso',
        title: 'Dados da empresa atualizados',
        description: 'As configurações organizacionais e visuais foram salvas com sucesso.',
      });
      router.refresh();
    });
  };

  const handleDiscard = () => setForm(inicial);

  return (
    <div className="flex flex-col gap-8 pb-20 animate-in fade-in duration-200 max-w-4xl">
      {/* ============================================================ */}
      {/* CABEÇALHO                                                    */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-1 border-b border-line pb-5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Empresa e identidade da marca
          </h2>
        </div>
        <p className="text-sm text-muted">
          Gerencie os dados organizacionais, preferências regionais e identidade visual exibida aos operadores e clientes.
        </p>
      </div>

      {/* ============================================================ */}
      {/* 1. DADOS DA EMPRESA                                          */}
      {/* ============================================================ */}
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center gap-2.5 border-b border-line pb-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Building2 className="size-4" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Dados institucionais
            </h3>
            <p className="text-xs text-muted">
              Informações formais utilizadas em notas de faturamento, relatórios e comunicações externas.
            </p>
          </div>
        </div>

        {/* Upload de Logotipo */}
        <div className="flex items-center gap-5 py-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`Logotipo de ${form.tradeName}`}
              className="size-20 shrink-0 rounded-2xl object-cover shadow-md"
            />
          ) : (
            <div
              className="flex size-20 shrink-0 items-center justify-center rounded-2xl font-display text-2xl font-bold text-white shadow-md transition-all"
              style={{ backgroundColor: form.brandColor }}
            >
              {form.tradeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink">Logotipo do workspace</span>
            <p className="text-[11px] text-muted">
              Formatos recomendados: PNG ou WEBP transparente de no mínimo 512x512px.
            </p>
            <div className="flex items-center gap-2 mt-1">
              <input
                ref={logoInputRef}
                type="file"
                accept={ALLOWED_LOGO_MIME_TYPES.join(',')}
                className="hidden"
                onChange={handleLogoChange}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Upload className="size-3.5" />}
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
              >
                {uploadingLogo ? 'Enviando…' : 'Alterar logotipo'}
              </Button>
            </div>
            {logoError ? <span className="text-[11px] text-red-text">{logoError}</span> : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 pt-2">
          <div>
            <label htmlFor="company-tradename" className="mb-1 block text-xs font-semibold text-ink">
              Nome fantasia (Exibição)
            </label>
            <input
              id="company-tradename"
              type="text"
              value={form.tradeName}
              onChange={(e) => set('tradeName', e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="company-legalname" className="mb-1 block text-xs font-semibold text-ink">
              Razão social completa
            </label>
            <input
              id="company-legalname"
              type="text"
              value={form.legalName}
              onChange={(e) => set('legalName', e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="company-document" className="mb-1 block text-xs font-semibold text-ink">
              CNPJ / Inscrição cadastral
            </label>
            <input
              id="company-document"
              type="text"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              aria-invalid={Boolean(erros.document)}
              aria-describedby={erros.document ? 'company-document-erro' : undefined}
              value={form.document}
              // A pontuação entra sozinha enquanto se digita: ninguém deveria
              // ter de lembrar onde vai a barra de um CNPJ.
              onChange={(e) => set('document', formatCompanyDocument(e.target.value))}
              className={campoClasse(Boolean(erros.document), true)}
            />
            {erros.document ? (
              <p id="company-document-erro" className="mt-1 text-[11px] text-red-text">
                {erros.document}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="company-email" className="mb-1 block text-xs font-semibold text-ink">
              E-mail principal de contato
            </label>
            <input
              id="company-email"
              type="email"
              placeholder="contato@suaempresa.com.br"
              aria-invalid={Boolean(erros.email)}
              aria-describedby={erros.email ? 'company-email-erro' : undefined}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className={campoClasse(Boolean(erros.email), false)}
            />
            {erros.email ? (
              <p id="company-email-erro" className="mt-1 text-[11px] text-red-text">
                {erros.email}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="company-phone" className="mb-1 block text-xs font-semibold text-ink">
              Telefone / WhatsApp corporativo
            </label>
            <input
              id="company-phone"
              type="tel"
              inputMode="tel"
              placeholder="(11) 98765-4321"
              aria-invalid={Boolean(erros.phone)}
              aria-describedby={erros.phone ? 'company-phone-erro' : undefined}
              value={form.phone}
              // Máscara só para número brasileiro. Um `+` na frente a desliga:
              // ver `maskCompanyPhoneInput`.
              onChange={(e) => set('phone', maskCompanyPhoneInput(e.target.value))}
              className={campoClasse(Boolean(erros.phone), true)}
            />
            {erros.phone ? (
              <p id="company-phone-erro" className="mt-1 text-[11px] text-red-text">
                {erros.phone}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="company-website" className="mb-1 block text-xs font-semibold text-ink">
              Site institucional
            </label>
            <input
              id="company-website"
              type="url"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="company-address" className="mb-1 block text-xs font-semibold text-ink">
              Endereço completo da sede
            </label>
            <input
              id="company-address"
              type="text"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 2. PREFERÊNCIAS REGIONAIS                                    */}
      {/* ============================================================ */}
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center gap-2.5 border-b border-line pb-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Globe className="size-4" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Preferências regionais
            </h3>
            <p className="text-xs text-muted">
              Valem para o workspace inteiro: o fuso das horas do atendimento, a
              moeda do funil, o formato das datas e o dia em que a semana começa
              nos filtros.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 pt-2">
          <div>
            <label htmlFor="pref-language" className="mb-1 block text-xs font-semibold text-ink">
              Idioma do sistema
            </label>
            <select
              id="pref-language"
              value={form.language}
              onChange={(e) => set('language', asLanguage(e.target.value))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              {LANGUAGES.map((valor) => (
                <option key={valor} value={valor}>
                  {LABELS_IDIOMA[valor]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pref-tz" className="mb-1 block text-xs font-semibold text-ink">
              Fuso horário oficial
            </label>
            <select
              id="pref-tz"
              value={form.timezone}
              onChange={(e) => set('timezone', asTimezone(e.target.value))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              {TIMEZONES.map((valor) => (
                <option key={valor} value={valor}>
                  {LABELS_FUSO[valor]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pref-currency" className="mb-1 block text-xs font-semibold text-ink">
              Moeda padrão
            </label>
            <select
              id="pref-currency"
              value={form.currency}
              onChange={(e) => set('currency', asCurrency(e.target.value))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              {CURRENCIES.map((valor) => (
                <option key={valor} value={valor}>
                  {LABELS_MOEDA[valor]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pref-dateformat" className="mb-1 block text-xs font-semibold text-ink">
              Formato de data
            </label>
            <select
              id="pref-dateformat"
              value={form.dateFormat}
              onChange={(e) => set('dateFormat', asDateFormat(e.target.value))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              {DATE_FORMATS.map((valor) => (
                <option key={valor} value={valor}>
                  {LABELS_DATA[valor]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pref-firstday" className="mb-1 block text-xs font-semibold text-ink">
              Início da semana
            </label>
            <select
              id="pref-firstday"
              value={form.firstDayOfWeek}
              onChange={(e) => set('firstDayOfWeek', asFirstDayOfWeek(e.target.value))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              {FIRST_DAYS_OF_WEEK.map((valor) => (
                <option key={valor} value={valor}>
                  {LABELS_PRIMEIRO_DIA[valor]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Barra Fixa Flutuante */}
      <UnsavedChangesBar
        show={dirty}
        isSaving={isSaving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        message="Você possui alterações pendentes nos dados da empresa."
      />
    </div>
  );
}
