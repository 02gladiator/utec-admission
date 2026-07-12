import type { TDocumentDefinitions } from "pdfmake/interfaces";
import type { Application } from "../../../entities/application/model/types";
import type { Program } from "../../../entities/program/model/types";

type PdfMakeModule = {
  addVirtualFileSystem: (vfs: unknown) => void;
  createPdf: (document: TDocumentDefinitions) => { download: (fileName: string) => void };
};

const yesNo = (value: boolean) => (value ? "Да" : "Нет");

export async function downloadAdmissionsReport(program: Program, applications: Application[]) {
  const pdfMakeModule = await import("pdfmake/build/pdfmake");
  const pdfMake = ((pdfMakeModule as { default?: unknown }).default ?? pdfMakeModule) as PdfMakeModule;
  const fontModule = await import("pdfmake/build/vfs_fonts");
  const fonts = (fontModule as { default?: unknown }).default ?? fontModule;
  pdfMake.addVirtualFileSystem(fonts);

  const generatedAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const rows = applications
    .slice()
    .sort((a, b) => b.averageScore - a.averageScore || a.fullName.localeCompare(b.fullName, "ru"))
    .map((application, index) => [
      String(index + 1),
      application.fullName,
      application.averageScore.toFixed(3).replace(".", ","),
      yesNo(application.originalGiven),
      yesNo(application.benefit),
    ]);

  const document: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 48, 40, 42],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    content: [
      { text: "Конкурсный список абитуриентов", style: "title" },
      { text: `${program.code} - ${program.name}`, style: "program" },
      { text: `Дата выгрузки: ${generatedAt}`, style: "date" },
      {
        margin: [0, 20, 0, 0],
        table: {
          headerRows: 1,
          widths: [28, "*", 70, 62, 50],
          body: [["№", "ФИО", "Средний балл", "Оригинал", "Льгота"], ...rows],
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#e8f1f8" : null),
          hLineColor: () => "#c7d3dd",
          vLineColor: () => "#c7d3dd",
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      },
      { text: `Всего заявлений: ${applications.length}`, style: "total" },
    ],
    styles: {
      title: { fontSize: 17, bold: true, color: "#123a5f" },
      program: { fontSize: 12, bold: true, margin: [0, 9, 0, 0] },
      date: { fontSize: 9, color: "#5d6c79", margin: [0, 5, 0, 0] },
      total: { fontSize: 9, color: "#5d6c79", margin: [0, 12, 0, 0] },
    },
  };

  const fileName = `konkursnyy-spisok-${program.code.replaceAll(".", "-")}.pdf`;
  pdfMake.createPdf(document).download(fileName);
}
