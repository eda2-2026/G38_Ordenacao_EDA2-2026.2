import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  GitCompareArrows,
  Info,
  ListFilter,
  Search,
} from "lucide-react";
import { sortWith, type SortMethod, type SortResult } from "./lib/sort";
import { candidateVisuals } from "./lib/candidateVisuals";

interface Candidate {
  id: string;
  numero: string;
  nome: string;
  votosNoRecorte: number;
}

interface Municipality {
  id: string;
  codigoTse: string;
  nome: string;
  uf: string;
  votosNominais: number;
  votosPorCandidato: Record<string, number>;
}

interface ElectionData {
  eleicao: string;
  turno: number;
  cargo: string;
  abrangencia: string;
  fonte: string;
  geradoPeloTseEm: string;
  registrosLidos: number;
  registrosSelecionados: number;
  votosNominais: number;
  candidatos: Candidate[];
  municipios: Municipality[];
}

type Metric = "share" | "votes" | "name";
type SortDirection = "asc" | "desc";
type RankedMunicipality = Municipality & { votos: number; percentual: number };
type Comparison = Record<SortMethod, SortResult<RankedMunicipality>> & {
  consistent: boolean;
};

const integer = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const sourcePage = "https://dadosabertos.tse.jus.br/dataset/resultados-2026";
const candidateSourcePage =
  "https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026";
const methods: SortMethod[] = ["merge", "quick", "heap"];
const methodNames: Record<SortMethod, string> = {
  merge: "Merge Sort",
  quick: "Quick Sort",
  heap: "Heap Sort",
};
const methodDetails: Record<SortMethod, string> = {
  merge: "Estável · O(n log n)",
  quick: "Mediana de três · médio O(n log n)",
  heap: "Pior caso O(n log n) · memória O(1)",
};
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function makeComparator(metric: Metric, direction: SortDirection) {
  return (left: RankedMunicipality, right: RankedMunicipality): number => {
    let primary = 0;
    if (metric === "share") primary = left.percentual - right.percentual;
    if (metric === "votes") primary = left.votos - right.votos;
    if (metric === "name") primary = collator.compare(left.nome, right.nome);
    if (direction === "desc") primary = -primary;
    if (primary !== 0) return primary;
    return (
      collator.compare(left.nome, right.nome) ||
      collator.compare(left.uf, right.uf) ||
      Number(left.codigoTse) - Number(right.codigoTse)
    );
  };
}

function exportCsv(
  rows: RankedMunicipality[],
  candidate: Candidate,
  metric: Metric,
  direction: SortDirection,
) {
  const header = [
    "Posição",
    "Município",
    "UF",
    "Código TSE",
    "Votos",
    "Votos nominais no município",
    "Participação (%)",
  ];
  const values = rows.map((row, index) => [
    index + 1,
    row.nome,
    row.uf,
    row.codigoTse,
    row.votos,
    row.votosNominais,
    (row.percentual * 100).toFixed(4).replace(".", ","),
  ]);
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const csv = [header, ...values]
    .map((line) => line.map(escape).join(";"))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `atlas-voto-2026-${candidate.numero}-${metric}-${direction}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Dashboard({ data }: { data: ElectionData }) {
  const defaultCandidate = data.candidatos.reduce((best, current) =>
    current.votosNoRecorte > best.votosNoRecorte ? current : best,
  );
  const [candidateId, setCandidateId] = useState(defaultCandidate.id);
  const [uf, setUf] = useState("BR");
  const [metric, setMetric] = useState<Metric>("share");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [method, setMethod] = useState<SortMethod>("merge");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const candidate = data.candidatos.find((item) => item.id === candidateId)!;
  const candidateVisual = candidateVisuals[candidate.numero] ?? {
    party: "Partido",
    color: "#287eef",
  };
  const snapshotShort =
    `${data.geradoPeloTseEm.slice(0, 6)}${data.geradoPeloTseEm.slice(8, 10)}`.replaceAll(
      "/",
      ".",
    );
  const heroShares = useMemo(() => {
    const featuredUfs = [
      "AC",
      "AM",
      "BA",
      "CE",
      "DF",
      "MG",
      "PA",
      "PR",
      "RJ",
      "RS",
      "SC",
      "SP",
    ];
    const shares = featuredUfs.map((state) => {
      let votes = 0;
      let total = 0;
      for (const city of data.municipios) {
        if (city.uf !== state) continue;
        votes += city.votosPorCandidato[candidateId] ?? 0;
        total += city.votosNominais;
      }
      return total ? votes / total : 0;
    });
    const highest = Math.max(...shares);
    return shares.map((share) =>
      Math.max(8, Math.round((share / highest) * 100)),
    );
  }, [candidateId]);
  const ufs = useMemo(
    () =>
      [...new Set(data.municipios.map((item) => item.uf))].sort(
        collator.compare,
      ),
    [],
  );
  const rows = useMemo(() => {
    const term = normalize(search.trim());
    return data.municipios
      .filter(
        (item) =>
          (uf === "BR" || item.uf === uf) &&
          (!term || normalize(item.nome).includes(term)),
      )
      .map((item) => {
        const votos = item.votosPorCandidato[candidateId] ?? 0;
        return {
          ...item,
          votos,
          percentual: item.votosNominais ? votos / item.votosNominais : 0,
        };
      });
  }, [candidateId, uf, search]);

  const comparator = useMemo(
    () => makeComparator(metric, direction),
    [metric, direction],
  );
  const ranking = useMemo(
    () => sortWith(rows, comparator, method),
    [rows, comparator, method],
  );
  const shown = ranking.items.slice((page - 1) * 20, page * 20);
  const pages = Math.max(1, Math.ceil(ranking.items.length / 20));
  const selectedVotes = rows.reduce((sum, row) => sum + row.votos, 0);
  const selectedNominalVotes = rows.reduce(
    (sum, row) => sum + row.votosNominais,
    0,
  );
  const topCity = rows.reduce<RankedMunicipality | null>(
    (best, row) => (!best || row.percentual > best.percentual ? row : best),
    null,
  );
  const leaderCities = rows.filter(
    (row) =>
      row.votos > 0 &&
      Object.entries(row.votosPorCandidato).every(
        ([id, votes]) => id === candidateId || row.votos > votes,
      ),
  ).length;
  const topRows = ranking.items.slice(0, 5);
  const maxBar = Math.max(
    1,
    ...topRows.map((row) => (metric === "votes" ? row.votos : row.percentual)),
  );
  const orderLabel =
    metric === "name"
      ? direction === "asc"
        ? "A → Z"
        : "Z → A"
      : direction === "asc"
        ? "Menores primeiro"
        : "Maiores primeiro";
  const highlightsTitle =
    metric === "name"
      ? "Primeiros do ranking"
      : metric === "votes"
        ? direction === "asc"
          ? "Menos votos"
          : "Mais votos"
        : direction === "asc"
          ? "Menor participação"
          : "Maior participação";

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
    setComparison(null);
  }

  function compareMethods() {
    const results = Object.fromEntries(
      methods.map((name) => [name, sortWith(rows, comparator, name)]),
    ) as Record<SortMethod, SortResult<RankedMunicipality>>;
    const reference = results.merge.items.map((item) => item.id);
    const consistent = methods.every((name) =>
      results[name].items.every((item, index) => item.id === reference[index]),
    );
    setComparison({ ...results, consistent });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner container">
          <a
            className="brand"
            href="#inicio"
            aria-label="Atlas do Voto, voltar ao início"
          >
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              atlas <span className="brand-light">do voto</span>
              <span className="brand-year">26</span>
            </span>
          </a>
          <nav className="site-nav" aria-label="Navegação principal">
            <a href="#explorar">Explorar</a>
            <a href="#laboratorio">Laboratório</a>
            <a href="#metodologia">Metodologia</a>
          </nav>
          <a
            className="header-source"
            href={sourcePage}
            target="_blank"
            rel="noreferrer"
          >
            Dados do TSE <ArrowUpRight size={15} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero container" id="inicio">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> ELEIÇÕES 2026 · 1º TURNO
            </div>
            <h1>
              Votação presidencial
              <br />
              <span>por município.</span>
            </h1>
            <p>
              Consulte os votos por candidatura e compare os algoritmos de
              ordenação.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#explorar">
                Ver resultados <ArrowRight size={17} />
              </a>
              <a className="text-link" href="#metodologia">
                Fonte e método <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="glass-card hero-card">
              <div className="card-topline">
                <span className="mini-icon">
                  <BarChart3 size={19} />
                </span>
                <span>VISÃO NACIONAL</span>
                <span className="tiny-pulse" />
              </div>
              <div className="hero-card-number">
                {integer.format(data.municipios.length)}
              </div>
              <div className="hero-card-label">municípios no recorte</div>
              <div className="hero-bars">
                {heroShares.map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="hero-card-footer">
                <span>Fonte: TSE</span>
                <span>04 OUT 2026</span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="stats-section container"
          aria-label="Resumo dos dados"
        >
          <div className="stat-card">
            <div className="stat-icon blue">
              <Database size={19} />
            </div>
            <div className="stat-number">
              {integer.format(data.municipios.length)}
            </div>
            <div className="stat-label">Municípios brasileiros</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon violet">
              <BarChart3 size={19} />
            </div>
            <div className="stat-number">
              {integer.format(data.candidatos.length)}
            </div>
            <div className="stat-label">Candidaturas presidenciais</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <Check size={19} />
            </div>
            <div className="stat-number">
              {integer.format(data.votosNominais)}
            </div>
            <div className="stat-label">Votos nominais no recorte</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange">
              <Clock3 size={19} />
            </div>
            <div className="stat-number">{snapshotShort}</div>
            <div className="stat-label">Snapshot gerado pelo TSE</div>
          </div>
        </section>

        <section
          className="explore-section"
          id="explorar"
          style={{ "--party-accent": candidateVisual.color } as CSSProperties}
        >
          <div className="container">
            <div className="section-heading">
              <div>
                <span className="section-kicker">RESULTADOS</span>
                <h2>Ranking por município</h2>
              </div>
              <div className="source-pill">
                <span className="live-dot" /> FONTE: TSE
              </div>
            </div>

            <div className="control-panel">
              <div className="controls-title">
                <ListFilter size={18} />
                <span>Filtros e ordenação</span>
              </div>
              <div className="control-grid">
                <label className="field">
                  <span>Candidatura</span>
                  <select
                    value={candidateId}
                    onChange={(event) =>
                      update(setCandidateId, event.target.value)
                    }
                  >
                    {data.candidatos.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.numero} · {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Estado</span>
                  <select
                    value={uf}
                    onChange={(event) => update(setUf, event.target.value)}
                  >
                    <option value="BR">Todo o Brasil</option>
                    {ufs.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Ordenar por</span>
                  <select
                    value={metric}
                    onChange={(event) => {
                      const next = event.target.value as Metric;
                      update(setMetric, next);
                      setDirection(next === "name" ? "asc" : "desc");
                    }}
                  >
                    <option value="share">
                      Participação nos votos nominais
                    </option>
                    <option value="votes">Quantidade de votos</option>
                    <option value="name">Nome do município</option>
                  </select>
                </label>
                <label className="field">
                  <span>Ordem</span>
                  <select
                    value={direction}
                    onChange={(event) =>
                      update(setDirection, event.target.value as SortDirection)
                    }
                  >
                    <option value="desc">
                      {metric === "name" ? "Z → A" : "Maiores primeiro"}
                    </option>
                    <option value="asc">
                      {metric === "name" ? "A → Z" : "Menores primeiro"}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>Algoritmo de ordenação</span>
                  <select
                    value={method}
                    onChange={(event) =>
                      update(setMethod, event.target.value as SortMethod)
                    }
                  >
                    {methods.map((item) => (
                      <option key={item} value={item}>
                        {methodNames[item]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="controls-note">
                A busca filtra municípios. O algoritmo ordena pelo critério e
                direção selecionados.
              </p>
            </div>

            <div className="candidate-profile">
              <img
                className="candidate-photo"
                src={`/candidates/${candidate.id}.jpg`}
                alt={`Foto de ${candidate.nome}`}
                width="76"
                height="76"
              />
              <div className="candidate-profile-copy">
                <span className="candidate-profile-label">
                  <i aria-hidden="true" /> CANDIDATURA
                </span>
                <strong>{candidate.nome}</strong>
                <span className="candidate-profile-party">
                  {candidateVisual.party} <span aria-hidden="true">·</span> Nº{" "}
                  {candidate.numero}
                </span>
              </div>
              <a
                className="candidate-photo-source"
                href={candidateSourcePage}
                target="_blank"
                rel="noreferrer"
              >
                Foto: TSE <ArrowUpRight size={13} />
              </a>
            </div>

            <div className="insight-grid">
              <div className="insight-card">
                <span>VOTOS PARA {candidate.numero} NO RECORTE</span>
                <strong>{integer.format(selectedVotes)}</strong>
                <small>
                  {percent.format(
                    selectedNominalVotes
                      ? selectedVotes / selectedNominalVotes
                      : 0,
                  )}{" "}
                  dos votos nominais encontrados
                </small>
              </div>
              <div className="insight-card">
                <span>MUNICÍPIOS EM QUE LIDERA</span>
                <strong>{integer.format(leaderCities)}</strong>
                <small>
                  Entre {integer.format(rows.length)}{" "}
                  {rows.length === 1
                    ? "município selecionado"
                    : "municípios selecionados"}
                </small>
              </div>
              <div className="insight-card">
                <span>MAIOR PARTICIPAÇÃO</span>
                <strong>
                  {topCity ? percent.format(topCity.percentual) : "—"}
                </strong>
                <small>
                  {topCity
                    ? `${topCity.nome} · ${topCity.uf}`
                    : "Nenhum município encontrado"}
                </small>
              </div>
            </div>

            <div className="rankings-layout">
              <div className="top-panel panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">PRIMEIROS 5</span>
                    <h3>{highlightsTitle}</h3>
                  </div>
                  <span className="circle-icon">
                    <ArrowUpRight size={18} />
                  </span>
                </div>
                <div className="top-list">
                  {topRows.length ? (
                    topRows.map((row, index) => (
                      <div className="top-item" key={row.id}>
                        <div className="top-line">
                          <span className="top-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="top-name" title={row.nome}>
                            {row.nome}
                            <small>{row.uf}</small>
                          </span>
                          <strong>
                            {metric === "votes"
                              ? integer.format(row.votos)
                              : percent.format(row.percentual)}
                          </strong>
                        </div>
                        <div className="top-track">
                          <span
                            style={{
                              width: `${Math.max(2, ((metric === "votes" ? row.votos : row.percentual) / maxBar) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">Nenhum município encontrado.</p>
                  )}
                </div>
                {metric === "name" && (
                  <div className="top-note">
                    <Info size={14} /> Barras: participação nos votos.
                  </div>
                )}
              </div>

              <div className="table-panel panel">
                <div className="panel-heading table-heading">
                  <div>
                    <span className="panel-kicker">RANKING COMPLETO</span>
                    <h3>
                      {integer.format(rows.length)}{" "}
                      {rows.length === 1 ? "município" : "municípios"}
                    </h3>
                  </div>
                  <button
                    className="export-button"
                    onClick={() =>
                      exportCsv(ranking.items, candidate, metric, direction)
                    }
                    disabled={!rows.length}
                  >
                    <ArrowDownToLine size={17} /> Exportar CSV
                  </button>
                </div>
                <div className="table-toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      aria-label="Buscar município"
                      placeholder="Buscar município..."
                      value={search}
                      onChange={(event) =>
                        update(setSearch, event.target.value)
                      }
                    />
                  </div>
                  <div className="sort-summary">
                    <span className="sort-dot" /> {orderLabel} ·{" "}
                    {methodNames[method]} ·{" "}
                    {integer.format(ranking.comparisons)} comparações
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Município</th>
                        <th>UF</th>
                        <th className="numeric">Votos</th>
                        <th className="numeric">Participação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row, index) => (
                        <tr key={row.id}>
                          <td className="rank-cell">
                            {(page - 1) * 20 + index + 1}
                          </td>
                          <td
                            className="city-cell"
                            title={`${row.nome} · ${row.uf}`}
                          >
                            {row.nome}
                            <span className="mobile-uf"> · {row.uf}</span>
                          </td>
                          <td>
                            <span className="uf-tag">{row.uf}</span>
                          </td>
                          <td className="numeric">
                            {integer.format(row.votos)}
                          </td>
                          <td className="numeric share-cell">
                            {percent.format(row.percentual)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!shown.length && (
                    <div className="empty-state">
                      Nenhum município corresponde à busca.
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  <span>
                    Mostrando {shown.length ? (page - 1) * 20 + 1 : 0}–
                    {Math.min(page * 20, rows.length)} de{" "}
                    {integer.format(rows.length)}
                  </span>
                  <div className="pagination">
                    <button
                      aria-label="Página anterior"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>
                      {page} / {pages}
                    </span>
                    <button
                      aria-label="Próxima página"
                      disabled={page === pages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lab-section" id="laboratorio">
          <div className="container">
            <div className="lab-header">
              <div>
                <span className="section-kicker">ALGORITMOS</span>
                <h2>
                  Comparação
                  <br />
                  <span>de desempenho</span>
                </h2>
                <p>
                  Merge Sort, Quick Sort e Heap Sort com os municípios
                  filtrados.
                </p>
              </div>
              <button
                className="button button-white"
                onClick={compareMethods}
                disabled={!rows.length}
              >
                <GitCompareArrows size={18} /> Comparar algoritmos
              </button>
            </div>
            <div className="algorithm-grid">
              {methods.map((name, index) => (
                <div
                  className={`algorithm-card ${comparison && method === name ? "algorithm-active" : ""}`}
                  key={name}
                >
                  <div className="algorithm-card-head">
                    <span className="algorithm-index">0{index + 1}</span>
                    <span className="algorithm-line" />
                  </div>
                  <h3>{methodNames[name]}</h3>
                  <p>{methodDetails[name]}</p>
                  <div className="algorithm-result">
                    <strong>
                      {comparison
                        ? `${comparison[name].durationMs.toFixed(3)} ms`
                        : "—"}
                    </strong>
                    <span>
                      {comparison
                        ? `${integer.format(comparison[name].comparisons)} comparações`
                        : "Aguardando comparação"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {comparison && (
              <div
                className={`consistency ${comparison.consistent ? "consistent-ok" : "consistent-error"}`}
              >
                <Check size={17} />{" "}
                {comparison.consistent
                  ? `Os três algoritmos produziram a mesma ordem para ${integer.format(rows.length)} ${rows.length === 1 ? "município" : "municípios"}.`
                  : "Os algoritmos produziram ordens diferentes. Verifique a implementação."}
              </div>
            )}
            <p className="lab-footnote">
              Tempos medidos no navegador, sem incluir a carga dos dados.
            </p>
          </div>
        </section>

        <section className="method-section container" id="metodologia">
          <div className="section-heading">
            <div>
              <span className="section-kicker">METODOLOGIA</span>
              <h2>Dados e critérios</h2>
            </div>
          </div>
          <div className="method-grid">
            <div className="method-card">
              <span>01</span>
              <div className="method-icon">
                <Database size={23} />
              </div>
              <h3>Fonte</h3>
              <p>Votação por seção eleitoral do TSE, primeiro turno de 2026.</p>
            </div>
            <div className="method-card">
              <span>02</span>
              <div className="method-icon">
                <ListFilter size={23} />
              </div>
              <h3>Recorte</h3>
              <p>Presidência e municípios brasileiros. Exterior excluído.</p>
            </div>
            <div className="method-card">
              <span>03</span>
              <div className="method-icon">
                <BarChart3 size={23} />
              </div>
              <h3>Ordenação</h3>
              <p>
                Merge, Quick e Heap Sort. Empates por nome, UF e código TSE.
              </p>
            </div>
          </div>
          <div className="source-banner">
            <div>
              <span className="source-banner-icon">
                <Info size={21} />
              </span>
              <div>
                <strong>Participação</strong>
                <p>
                  Votos da candidatura ÷ votos nominais no município. Brancos e
                  nulos excluídos.
                </p>
                <small>Arquivo do TSE gerado em {data.geradoPeloTseEm}.</small>
              </div>
            </div>
            <a href={sourcePage} target="_blank" rel="noreferrer">
              Fonte oficial <ExternalLink size={16} />
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <a className="brand" href="#inicio">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              atlas <span className="brand-light">do voto</span>
              <span className="brand-year">26</span>
            </span>
          </a>
          <span>Projeto acadêmico · EDA2 · Grupo 38</span>
          <a
            href="https://github.com/eda2-2026/G38_Ordenacao_EDA2-2026.2"
            target="_blank"
            rel="noreferrer"
          >
            Ver repositório <ArrowUpRight size={15} />
          </a>
        </div>
      </footer>
    </div>
  );
}

function App() {
  const [data, setData] = useState<ElectionData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data/municipios-2026.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ElectionData>;
      })
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível carregar o arquivo de dados. Atualize a página para tentar novamente.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  if (error)
    return (
      <main className="load-state">
        <strong>Dados indisponíveis</strong>
        <p>{error}</p>
      </main>
    );
  if (!data)
    return (
      <main className="load-state">
        <span className="loading-dot" />
        <strong>Carregando dados</strong>
      </main>
    );
  return <Dashboard data={data} />;
}

export default App;
