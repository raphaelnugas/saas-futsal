@echo off
echo === Configuracao do PostgreSQL ===
echo.

REM Verificar localizacao do PostgreSQL
if exist "Z:\PostgreSQL\16" (
    set POSTGRES_PATH=Z:\PostgreSQL\16
) else if exist "C:\Program Files\PostgreSQL\16" (
    set POSTGRES_PATH=C:\Program Files\PostgreSQL\16
) else (
    echo ERRO: PostgreSQL nao encontrado em Z:\PostgreSQL\16 nem em C:\Program Files\PostgreSQL\16
    echo Por favor, verifique onde o PostgreSQL esta instalado
    pause
    exit /b 1
)

set PSQL_PATH=%POSTGRES_PATH%\bin\psql.exe

echo PostgreSQL encontrado em: %POSTGRES_PATH%
echo.

REM Testar conexao
echo Testando conexao com PostgreSQL...
"%PSQL_PATH%" -U postgres -d postgres -c "SELECT version();"
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Nao foi possivel conectar ao PostgreSQL
    echo Verifique se o servico esta rodando e as credenciais estao corretas
    pause
    exit /b 1
)
echo.

REM Criar banco de dados
echo === Criando banco de dados futsal_nautico ===
"%PSQL_PATH%" -U postgres -d postgres -c "CREATE DATABASE futsal_nautico;"
if %ERRORLEVEL% EQU 0 (
    echo Banco de dados criado com sucesso!
) else (
    echo Banco de dados ja existe ou houve um erro
)
echo.

REM Criar tabelas
echo === Criando tabelas ===
if exist "database\schema.sql" (
    echo Executando schema.sql...
    "%PSQL_PATH%" -U postgres -d futsal_nautico -f "database\schema.sql"
    if %ERRORLEVEL% EQU 0 (
        echo Schema criado com sucesso
    ) else (
        echo Erro ao criar schema
    )
) else (
    echo Arquivo schema.sql nao encontrado
)
echo.

REM Inserir dados de teste
echo === Inserindo dados de teste ===
if exist "database\test-data.sql" (
    echo Executando test-data.sql...
    "%PSQL_PATH%" -U postgres -d futsal_nautico -f "database\test-data.sql"
    if %ERRORLEVEL% EQU 0 (
        echo Dados de teste inseridos com sucesso
    ) else (
        echo Erro ao inserir dados
    )
) else (
    echo Arquivo test-data.sql nao encontrado
)
echo.

REM Verificar tabelas
echo === Verificando tabelas criadas ===
"%PSQL_PATH%" -U postgres -d futsal_nautico -c "\dt"
echo.

REM Verificar dados
echo === Verificando dados inseridos ===
"%PSQL_PATH%" -U postgres -d futsal_nautico -c "SELECT COUNT(*) as total_players FROM players;"
"%PSQL_PATH%" -U postgres -d futsal_nautico -c "SELECT COUNT(*) as total_matches FROM matches;"
echo.

echo === Configuracao concluida! ===
echo.
echo Proximos passos:
echo 1. Execute 'node database/test-connection-local.js' para testar a conexao
echo 2. Configure as variaveis de ambiente no arquivo .env
echo 3. Inicie o servidor backend com 'npm run dev'
echo.
echo Configuracao do banco de dados:
echo - Host: localhost
echo - Port: 5432
echo - Database: futsal_nautico
echo - User: postgres
echo - Password: [sua senha do postgres]
echo.
pause