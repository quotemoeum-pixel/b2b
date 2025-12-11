import { useState } from 'react';
import Head from 'next/head';
import ExcelJS from 'exceljs';
import AuthLayout from '@/components/AuthLayout';

export default function TemplateTest() {
  const [templateFile, setTemplateFile] = useState(null);
  const [templateFileName, setTemplateFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 템플릿 파일 업로드
  const handleTemplateUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setTemplateFile(file);
    setTemplateFileName(file.name);
    setError('');
    setSuccess('');
  };

  // 템플릿에 데이터 입력 후 다운로드
  const handleProcess = async () => {
    if (!templateFile) {
      setError('템플릿 파일을 먼저 업로드해주세요.');
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess('');

    try {
      // 1. 템플릿 파일 읽기
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await templateFile.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);

      // 2. 첫 번째 시트 선택
      const sheet = workbook.getWorksheet(1);

      // 3. C2 셀에 "홍길동" 입력 (서식 유지)
      sheet.getCell('C2').value = '홍길동';

      // 4. 다운로드
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `결과_${templateFileName}`;
      a.click();
      URL.revokeObjectURL(url);

      setSuccess('C2 셀에 "홍길동"이 입력된 파일이 다운로드되었습니다.');
    } catch (err) {
      console.error('처리 오류:', err);
      setError('파일 처리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AuthLayout>
      <Head>
        <title>템플릿 테스트</title>
      </Head>

      <main className="py-10">
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
            엑셀 템플릿 테스트
          </h1>

          <p className="text-sm text-gray-600 mb-6 text-center">
            엑셀 파일을 업로드하면 C2 셀에 &quot;홍길동&quot;을 입력하고 다운로드합니다.<br />
            기존 서식(스타일, 병합, 테두리 등)은 그대로 유지됩니다.
          </p>

          {/* 템플릿 업로드 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              템플릿 엑셀 파일 업로드
            </label>
            <input
              type="file"
              accept=".xlsx"
              onChange={handleTemplateUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {templateFileName && (
              <p className="mt-2 text-sm text-green-600">
                ✓ {templateFileName} 업로드됨
              </p>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 성공 메시지 */}
          {success && (
            <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-md">
              {success}
            </div>
          )}

          {/* 처리 버튼 */}
          <button
            onClick={handleProcess}
            disabled={processing || !templateFile}
            className={`w-full py-3 px-4 rounded-md text-white font-medium ${
              processing || !templateFile
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {processing ? '처리 중...' : 'C2에 "홍길동" 입력 후 다운로드'}
          </button>

          {/* 안내 */}
          <div className="mt-6 p-4 bg-gray-50 rounded-md">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">테스트 방법</h3>
            <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
              <li>서식이 있는 .xlsx 파일을 업로드합니다</li>
              <li>버튼을 클릭합니다</li>
              <li>다운로드된 파일에서 C2 셀에 &quot;홍길동&quot;이 입력되었는지 확인</li>
              <li>기존 서식(글꼴, 색상, 테두리, 병합 등)이 유지되었는지 확인</li>
            </ol>
          </div>
        </div>
      </main>
    </AuthLayout>
  );
}
