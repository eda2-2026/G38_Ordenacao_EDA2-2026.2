import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import unzipper from "unzipper";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = resolve(root, ".cache/votacao_secao_2026_BR.zip");
const outputPath = resolve(root, "public/data/municipios-2026.json");
const sourceUrl =
  "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2026_BR.zip";

async function ensureZip(refresh) {
  if (!refresh) {
    try {
      if ((await stat(zipPath)).size > 0) return;
    } catch {}
  }

  await mkdir(dirname(zipPath), { recursive: true });
  const temporary = `${zipPath}.part`;
  console.log(`Baixando ${sourceUrl}`);
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body)
    throw new Error(`Falha no download: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  await rename(temporary, zipPath);
}

export async function importElectionData(
  sourceZip = zipPath,
  destination = outputPath,
) {
  const archive = await unzipper.Open.file(sourceZip);
  const entry = archive.files.find((file) =>
    file.path.endsWith("votacao_secao_2026_BR.csv"),
  );
  if (!entry) throw new Error("CSV presidencial não encontrado no ZIP do TSE.");

  const parser = entry
    .stream()
    .pipe(iconv.decodeStream("latin1"))
    .pipe(parse({ delimiter: ";", from_line: 2, relax_quotes: true }));

  const municipalities = new Map();
  const candidates = new Map();
  let sourceGeneratedAt = "";
  let readRows = 0;
  let selectedRows = 0;

  for await (const row of parser) {
    readRows++;
    if (row[5] !== "1" || row[18] !== "Presidente") continue;
    if (row[10] === "ZZ") continue; // Exterior.
    const candidateId = row[23];
    if (!candidateId || Number(candidateId) <= 0) continue; // 95/96: branco e nulo.

    const votes = Number(row[21]);
    if (!Number.isSafeInteger(votes) || votes < 0) {
      throw new Error(`Quantidade de votos inválida na linha ${readRows + 1}.`);
    }
    selectedRows++;
    if (!sourceGeneratedAt) sourceGeneratedAt = `${row[0]} ${row[1]}`;

    const uf = row[10];
    const code = row[13];
    const key = `${uf}-${code}`;
    let municipality = municipalities.get(key);
    if (!municipality) {
      municipality = {
        id: key,
        codigoTse: code,
        nome: row[14],
        uf,
        votosNominais: 0,
        votosPorCandidato: {},
      };
      municipalities.set(key, municipality);
    }

    municipality.votosNominais += votes;
    municipality.votosPorCandidato[candidateId] =
      (municipality.votosPorCandidato[candidateId] ?? 0) + votes;

    const candidate = candidates.get(candidateId);
    if (candidate) candidate.votosNoRecorte += votes;
    else
      candidates.set(candidateId, {
        id: candidateId,
        numero: row[19],
        nome: row[20],
        votosNoRecorte: votes,
      });
  }

  if (municipalities.size < 5000 || candidates.size < 2) {
    throw new Error(
      `Base incompleta: ${municipalities.size} municípios e ${candidates.size} candidaturas.`,
    );
  }

  const totalVotes = [...candidates.values()].reduce(
    (sum, candidate) => sum + candidate.votosNoRecorte,
    0,
  );
  const municipalVotes = [...municipalities.values()].reduce(
    (sum, city) => sum + city.votosNominais,
    0,
  );
  if (totalVotes !== municipalVotes)
    throw new Error("Totais das candidaturas e municípios divergem.");

  const result = {
    eleicao: "Eleição Geral Federal 2026",
    turno: 1,
    cargo: "Presidente",
    abrangencia: "Municípios brasileiros; exterior excluído",
    fonte: sourceUrl,
    geradoPeloTseEm: sourceGeneratedAt,
    registrosLidos: readRows,
    registrosSelecionados: selectedRows,
    votosNominais: totalVotes,
    candidatos: [...candidates.values()].sort(
      (a, b) => Number(a.numero) - Number(b.numero),
    ),
    municipios: [...municipalities.values()].sort((a, b) =>
      a.id.localeCompare(b.id, "pt-BR"),
    ),
  };

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(result)}\n`, "utf8");
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await ensureZip(process.argv.includes("--refresh"));
  const result = await importElectionData();
  console.log(
    `Importados ${result.municipios.length} municípios, ${result.candidatos.length} candidaturas e ${result.votosNominais.toLocaleString("pt-BR")} votos nominais.`,
  );
  console.log(
    `Snapshot TSE: ${result.geradoPeloTseEm}. Arquivo: ${outputPath}`,
  );
}
