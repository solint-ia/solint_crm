'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  foldText,
  prepareImport,
  sniffColumnKind,
  type ImportRow,
} from '@/core/domain/contact-import';
import { importContactsCsvAction, type ImportCsvResult } from '@/app/(workspace)/contatos/actions';

export interface ParsedCsvRow {
  readonly [key: string]: string;
}

export type TargetField =
  | 'company'
  | 'cnpj'
  | 'companyAddress'
  | 'companyPhone'
  | 'partnerPhone'
  | 'classification'
  | 'whatsappFlag'
  | 'ignore';

const TARGET_FIELDS: { key: TargetField; label: string; required: boolean }[] = [
  { key: 'company', label: 'Empresa / Razão Social', required: true },
  { key: 'cnpj', label: 'CNPJ', required: false },
  { key: 'companyAddress', label: 'Endereço da Empresa', required: false },
  { key: 'companyPhone', label: 'Telefone da Empresa', required: false },
  { key: 'partnerPhone', label: 'Telefone do Sócio', required: false },
  { key: 'whatsappFlag', label: 'WhatsApp (Sim/Não)', required: false },
  { key: 'classification', label: 'Classificação', required: false },
  { key: 'ignore', label: '(Ignorar esta coluna)', required: false },
];

/** Divide uma linha CSV respeitando aspas */
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Detecta se o delimitador é vírgula ou ponto-e-vírgula */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (semicolonCount > commaCount && semicolonCount >= tabCount) return ';';
  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  return ',';
}

function parseCsv(text: string): { headers: string[]; rows: ParsedCsvRow[] } {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(clean);
  const headers = parseCsvLine(lines[0]!, delimiter).map((h) =>
    h.replace(/^["']|["']$/g, '').trim(),
  );

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').replace(/^["']|["']$/g, '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Para que serve esta coluna?
 *
 * O cabeçalho sozinho engana. Nas exportações de prospecção existe uma coluna
 * chamada exatamente "WhatsApp" que **não** tem números: tem "Sim" e "Não",
 * dizendo se aquele telefone recebe mensagem. Um detector que confiasse no nome
 * mapearia "Sim" como telefone, e a planilha inteira seria recusada linha a
 * linha sem explicar o motivo.
 *
 * Por isso o conteúdo decide primeiro, e o cabeçalho só desempata — é o
 * caminho inverso do que parece natural, e é o que funciona.
 */
function autoDetectField(header: string, amostra: readonly string[]): TargetField {
  const conteudo = sniffColumnKind(amostra);
  const h = foldText(header);

  // O layout B2B tem contrato de cabeçalhos conhecido. Ele vence qualquer
  // heurística de conteúdo para que "Telefone da Empresa" nunca seja ignorado.
  if (h === 'empresa' || h === 'razaosocial') return 'company';
  if (h === 'cnpj') return 'cnpj';
  if (h === 'enderecodaempresa' || h === 'enderecoempresa') return 'companyAddress';
  if (h === 'telefonedaempresa' || h === 'telefoneempresa') return 'companyPhone';
  if (h === 'telefonedosocio' || h === 'telefonesocio') return 'partnerPhone';
  if (h === 'classificacao') return 'classification';
  if (h === 'whatsapp') return 'whatsappFlag';

  // Uma coluna de Sim/Não só pode ser a marcação de WhatsApp.
  if (conteudo === 'sim-nao') {
    return h.includes('whatsapp') || h.includes('zap') ? 'whatsappFlag' : 'ignore';
  }

  // Entre duas colunas de telefone (a da empresa e a do sócio), a do sócio é a
  // que interessa: é o celular de quem atende, não o fixo da recepção.
  if (conteudo === 'telefone') return 'companyPhone';
  if (h.includes('empresa') || h.includes('company') || h.includes('razaosocial')) return 'company';
  return 'ignore';
}

export function ImportCsvModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'mapeamento' | 'resultado'>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [batchName, setBatchName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, TargetField>>({});
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCsvResult | null>(null);

  const reset = () => {
    setStep('upload');
    setFileName('');
    setBatchName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setLoading(false);
    setErrorMsg(null);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setErrorMsg('Por favor, selecione um arquivo válido no formato .csv');
      return;
    }

    setFileName(file.name);
    setBatchName((current) => current || file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' '));
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) {
        setErrorMsg('O arquivo está vazio.');
        return;
      }

      const parsed = parseCsv(content);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setErrorMsg('Nenhuma linha de contato encontrada no arquivo.');
        return;
      }

      const initialMapping: Record<string, TargetField> = {};
      parsed.headers.forEach((h) => {
        // Vinte linhas bastam para reconhecer o tipo da coluna e não custam
        // nada; varrer o arquivo inteiro para isso atrasaria o passo de
        // mapeamento numa planilha de milhares de linhas.
        const amostra = parsed.rows.slice(0, 20).map((row) => row[h] ?? '');
        initialMapping[h] = autoDetectField(h, amostra);
      });

      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(initialMapping);
      setStep('mapeamento');
    };

    reader.onerror = () => {
      setErrorMsg('Falha ao ler o arquivo selecionado.');
    };

    reader.readAsText(file);
  };

  /**
   * O filtro por WhatsApp só existe quando há uma coluna dizendo isso.
   *
   * Numa planilha comum, sem essa coluna, filtrar descartaria tudo — o padrão
   * precisa ser "importa tudo", e o filtro é o caso especial que a presença da
   * coluna liga.
   */
  const temColunaWhatsapp = Object.values(mapping).includes('whatsappFlag');

  /**
   * O que a planilha vai virar — calculado com as **mesmas** regras da
   * gravação, e não com uma estimativa parecida.
   *
   * Sem isto, o botão prometia "Importar 200 contatos" e o resultado dizia 40,
   * porque as linhas repetidas da mesma pessoa se juntam e as sem WhatsApp
   * caem. Um número que muda entre o clique e o resultado é pior que número
   * nenhum: a pessoa acha que perdeu 160 contatos.
   */
  const previa = useMemo(() => {
    if (step !== 'mapeamento' || rows.length === 0) return null;
    const mapeadas = Object.values(mapping);
    if (!mapeadas.includes('company')) return null;

    const linhas: ImportRow[] = rows.map((row) => {
      let company = '';
      let cnpj = '';
      let companyAddress = '';
      let companyPhone = '';
      let partnerPhone = '';
      let classification = '';
      let whatsappFlag = '';
      Object.entries(mapping).forEach(([csvHeader, targetField]) => {
        const val = row[csvHeader] ?? '';
        if (targetField === 'company') company = val;
        if (targetField === 'cnpj') cnpj = val;
        if (targetField === 'companyAddress') companyAddress = val;
        if (targetField === 'companyPhone') companyPhone = val;
        if (targetField === 'partnerPhone') partnerPhone = val;
        if (targetField === 'classification') classification = val;
        if (targetField === 'whatsappFlag') whatsappFlag = val;
      });
      return {
        company,
        cnpj,
        companyAddress,
        companyPhone,
        partnerPhone,
        classification,
        whatsappFlag,
      };
    });

    return prepareImport(linhas);
    // `temColunaWhatsapp` sai da lista por ser derivado de `mapping`, que já
    // está aqui: mantê-lo não acrescentava um recálculo, só ruído.
  }, [step, rows, mapping]);

  const handleImport = async () => {
    const mappedValues = Object.values(mapping);
    const hasCompany = mappedValues.includes('company');
    const hasPhone = mappedValues.includes('companyPhone') || mappedValues.includes('partnerPhone');

    if (batchName.trim().length < 2) {
      setErrorMsg('Informe um nome para a lista de importação.');
      return;
    }
    if (!hasCompany || !hasPhone) {
      setErrorMsg('É necessário mapear Empresa e ao menos uma coluna de telefone.');
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      /**
       * A planilha vira contatos aqui, pelas regras do domínio.
       *
       * Duas coisas acontecem, e as duas mudam a contagem que o usuário vê:
       * as linhas sem "Sim" na coluna de WhatsApp são descartadas, e as linhas
       * da mesma pessoa (mesmo nome, mesma empresa) viram **um** contato com
       * vários números. Uma planilha de 200 linhas costuma virar 40 contatos.
       */
      const linhas: ImportRow[] = rows.map((row) => {
        let company = '';
        let cnpj = '';
        let companyAddress = '';
        let companyPhone = '';
        let partnerPhone = '';
        let classification = '';
        let whatsappFlag = '';

        Object.entries(mapping).forEach(([csvHeader, targetField]) => {
          const val = row[csvHeader] ?? '';
          if (targetField === 'company') company = val;
          if (targetField === 'cnpj') cnpj = val;
          if (targetField === 'companyAddress') companyAddress = val;
          if (targetField === 'companyPhone') companyPhone = val;
          if (targetField === 'partnerPhone') partnerPhone = val;
          if (targetField === 'classification') classification = val;
          if (targetField === 'whatsappFlag') whatsappFlag = val;
        });

        return {
          company,
          cnpj,
          companyAddress,
          companyPhone,
          partnerPhone,
          classification,
          whatsappFlag,
        };
      });

      const preparo = prepareImport(linhas);
      const contactsToImport = preparo.contacts.map((contato) => ({
        name: contato.name,
        company: contato.company,
        cnpj: contato.cnpj,
        companyAddress: contato.companyAddress,
        companyPhone: contato.companyPhone,
        partnerPhone: contato.partnerPhone,
        whatsappFlag: contato.partnerPhone ? 'Sim' : '',
        classification: contato.classification,
      }));

      if (contactsToImport.length === 0) {
        setErrorMsg(
          preparo.semWhatsapp > 0
            ? `Nenhum contato com empresa e telefone válidos foi encontrado.`
            : 'Nenhum contato com empresa e telefone válidos foi encontrado.',
        );
        setLoading(false);
        return;
      }

      const res = await importContactsCsvAction({
        batchName: batchName.trim(),
        contacts: contactsToImport,
      });

      if (!res.ok || !res.data) {
        setErrorMsg(res.error ?? 'Erro ao importar contatos.');
        setLoading(false);
        return;
      }

      setResult(res.data);
      setStep('resultado');
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro inesperado na importação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Importar contatos por CSV"
      description="Importe planilhas de contatos, clientes ou leads diretamente para a sua base do CRM."
      footer={
        step === 'upload' ? (
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancelar
          </Button>
        ) : step === 'mapeamento' ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStep('upload')}
              disabled={loading}
            >
              Voltar
            </Button>
            <Button size="sm" onClick={handleImport} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Importando...</span>
                </>
              ) : (
                <>
                  <span>
                    Importar {previa ? previa.contacts.length : rows.length}{' '}
                    {(previa ? previa.contacts.length : rows.length) === 1 ? 'contato' : 'contatos'}
                  </span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleClose}>
            Concluir
          </Button>
        )
      }
    >
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-300">
          <AlertCircle className="size-4 shrink-0 text-red-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink">
            Nome da lista importada
            <input
              type="text"
              value={batchName}
              onChange={(event) => setBatchName(event.target.value)}
              maxLength={120}
              placeholder="Ex.: Prospecção Fortaleza (setembro)"
              className="h-10 rounded-xl border border-line bg-surface px-3 text-body font-normal text-ink outline-none transition-all placeholder:text-dim focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-soft bg-surface-2/40 p-8 text-center cursor-pointer transition-all hover:border-brand/40 hover:bg-surface-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <div className="flex size-12 items-center justify-center rounded-2xl bg-brand/12 text-brand">
              <UploadCloud className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                Clique para selecionar ou arraste o arquivo CSV
              </p>
              <p className="mt-1 text-xs text-muted">
                Suporta planilhas exportadas do Excel, Google Sheets ou outros CRMs.
              </p>
            </div>
          </label>

          <div className="rounded-xl border border-line bg-surface p-3.5 text-xs text-muted">
            <p className="font-semibold text-ink mb-1.5 flex items-center gap-1.5">
              <FileSpreadsheet className="size-3.5 text-brand" />
              <span>Colunas reconhecidas automaticamente:</span>
            </p>
            <ul className="list-disc pl-4 space-y-1 text-dim">
              <li>
                <strong className="text-ink">Empresa</strong> e ao menos um telefone
              </li>
              <li>CNPJ, Endereço da Empresa e Classificação</li>
              <li>Telefone da Empresa, Telefone do Sócio e WhatsApp</li>
            </ul>
            <p className="mt-2 border-t border-line-soft pt-2 text-[11px] text-dim">
              O telefone do sócio só é armazenado quando a célula WhatsApp contém exatamente
              &ldquo;Sim&rdquo;. As demais colunas são descartadas.
            </p>
          </div>
        </div>
      )}

      {step === 'mapeamento' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-brand" />
              <span className="text-xs font-semibold text-ink">{fileName}</span>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                {rows.length} linhas
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="text-xs text-muted hover:text-ink"
            >
              Trocar arquivo
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
            Nome da lista
            <input
              type="text"
              value={batchName}
              onChange={(event) => setBatchName(event.target.value)}
              maxLength={120}
              className="h-9 rounded-lg border border-line bg-surface px-3 text-xs font-normal text-ink outline-none focus:border-brand"
            />
          </label>

          {/* O que a planilha vai virar, com as contas à vista. */}
          {previa ? (
            <div className="rounded-xl border border-line bg-surface-2/50 p-3 text-[11px] text-muted">
              <p className="text-xs font-semibold text-ink">
                {rows.length} linha(s) → {previa.contacts.length} contato(s)
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {temColunaWhatsapp ? (
                  <li>
                    <strong className="text-ink">{previa.semWhatsapp}</strong> telefone(s) de sócio
                    descartado(s) porque WhatsApp não era exatamente “Sim”.
                  </li>
                ) : (
                  <li>Sem coluna WhatsApp: telefones de sócio não serão armazenados.</li>
                )}
                {previa.agrupadas > 0 ? (
                  <li>
                    <strong className="text-ink">{previa.agrupadas}</strong> linha(s) da mesma
                    pessoa foram juntadas, e o contato fica com vários números.
                  </li>
                ) : null}
                {previa.invalidas > 0 ? (
                  <li>
                    <strong className="text-ink">{previa.invalidas}</strong> linha(s) sem nome ou
                    com empresa ou telefone utilizável.
                  </li>
                ) : null}
              </ul>

              {previa.contacts.some((c) => c.phones.length > 1) ? (
                <p className="mt-2 border-t border-line-soft pt-2">
                  Exemplo:{' '}
                  {(() => {
                    const exemplo = previa.contacts.find((c) => c.phones.length > 1)!;
                    return (
                      <>
                        <strong className="text-ink">{exemplo.name}</strong> com{' '}
                        {exemplo.phones.length} números ({exemplo.phones.join(', ')})
                      </>
                    );
                  })()}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted">
            Relacione as colunas da sua planilha aos campos correspondentes no CRM:
          </p>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {headers.map((header) => (
              <div
                key={header}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink truncate block">{header}</span>
                  <span className="text-[11px] text-muted truncate block">
                    Ex: {rows[0]?.[header] || '(vazio)'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <ArrowRight className="size-3.5 text-muted" />
                  <select
                    value={mapping[header] ?? 'ignore'}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [header]: e.target.value as TargetField,
                      }))
                    }
                    className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs font-semibold text-ink outline-none focus:border-brand"
                  >
                    {TARGET_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label} {field.required ? '*' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Prévia dos Primeiros Contatos */}
          <div className="rounded-xl border border-line-soft bg-surface-2/40 p-3">
            <p className="text-[11px] font-bold text-ink mb-2">Prévia dos primeiros registros:</p>
            <div className="overflow-x-auto text-[11px]">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="pb-1 pr-2 font-medium">Empresa</th>
                    <th className="pb-1 pr-2 font-medium">Telefone empresa</th>
                    <th className="pb-1 font-medium">Telefone sócio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.slice(0, 3).map((r, i) => {
                    const companyHeader = Object.keys(mapping).find(
                      (k) => mapping[k] === 'company',
                    );
                    const companyPhoneHeader = Object.keys(mapping).find(
                      (k) => mapping[k] === 'companyPhone',
                    );
                    const partnerPhoneHeader = Object.keys(mapping).find(
                      (k) => mapping[k] === 'partnerPhone',
                    );
                    const whatsappHeader = Object.keys(mapping).find(
                      (k) => mapping[k] === 'whatsappFlag',
                    );

                    return (
                      <tr key={i}>
                        <td className="py-1 pr-2 font-semibold text-ink">
                          {companyHeader ? r[companyHeader] : '-'}
                        </td>
                        <td className="py-1 pr-2 text-muted">
                          {companyPhoneHeader ? r[companyPhoneHeader] : '-'}
                        </td>
                        <td className="py-1 text-muted">
                          {partnerPhoneHeader && whatsappHeader && r[whatsappHeader] === 'Sim'
                            ? r[partnerPhoneHeader]
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 'resultado' && result && (
        <div className="flex flex-col gap-4 animate-in fade-in">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-6 shrink-0 text-emerald-500" />
            <div>
              <p className="text-sm font-bold text-ink">
                Lista &ldquo;{result.batchName}&rdquo; importada!
              </p>
              <p className="text-xs text-muted mt-0.5">
                {result.importedCount} novos contatos criados e {result.updatedCount} atualizados.
              </p>
            </div>
          </div>

          {result.errorCount > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200">
              <p className="font-bold flex items-center gap-1.5">
                <AlertCircle className="size-4 text-amber-500" />
                <span>{result.errorCount} linha(s) ignorada(s):</span>
              </p>
              <ul className="mt-2 list-disc pl-4 space-y-1 max-h-36 overflow-y-auto text-[11px]">
                {result.errors.map((err, i) => (
                  <li key={i}>
                    Linha {err.line} ({err.name}): {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
