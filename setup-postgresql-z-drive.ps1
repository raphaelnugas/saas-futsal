# Script de Configuração do PostgreSQL para Unidade Z:
# Este script configura o PostgreSQL quando instalado na unidade Z:

Write-Host "=== Configuração do PostgreSQL na Unidade Z ===" -ForegroundColor Green
Write-Host ""

# Definir o caminho do PostgreSQL na unidade Z:
$postgresPath = "Z:\PostgreSQL\16"
$binPath = "$postgresPath\bin"
$dataPath = "$postgresPath\data"

# Verificar se o PostgreSQL está instalado na unidade Z:
if (-not (Test-Path $postgresPath)) {
    Write-Host "ERRO: PostgreSQL não encontrado em $postgresPath" -ForegroundColor Red
    Write-Host "Por favor, verifique se o PostgreSQL está instalado na unidade Z:" -ForegroundColor Yellow
    exit 1
}

Write-Host "PostgreSQL encontrado em: $postgresPath" -ForegroundColor Green

# Adicionar o bin do PostgreSQL ao PATH temporariamente
$env:PATH = "$binPath;$env:PATH"

# Função para executar comandos PostgreSQL
function Execute-PostgreSqlCommand {
    param(
        [string]$command,
        [string]$database = "postgres",
        [string]$description = ""
    )
    
    if ($description) {
        Write-Host "Executando: $description" -ForegroundColor Cyan
    }
    
    try {
        $result = & "$binPath\psql.exe" -U postgres -d $database -c "$command" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Sucesso" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ Erro: $result" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "✗ Exceção: $_" -ForegroundColor Red
        return $false
    }
}

# Função para verificar se o serviço está rodando
function Test-PostgreSqlService {
    try {
        $service = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
        if ($service -and $service.Status -eq 'Running') {
            Write-Host "Serviço PostgreSQL está rodando" -ForegroundColor Green
            return $true
        } else {
            Write-Host "Serviço PostgreSQL não está rodando" -ForegroundColor Yellow
            return $false
        }
    }
    catch {
        Write-Host "Não foi possível verificar o serviço: $_" -ForegroundColor Yellow
        return $false
    }
}

# Iniciar serviço se necessário
if (-not (Test-PostgreSqlService)) {
    Write-Host "Tentando iniciar o serviço PostgreSQL..." -ForegroundColor Yellow
    try {
        Start-Service -Name "postgresql*" -ErrorAction Stop
        Start-Sleep -Seconds 5
        Write-Host "Serviço iniciado com sucesso" -ForegroundColor Green
    }
    catch {
        Write-Host "ERRO: Não foi possível iniciar o serviço PostgreSQL" -ForegroundColor Red
        Write-Host "Por favor, inicie o serviço manualmente" -ForegroundColor Yellow
        exit 1
    }
}

# Testar conexão
Write-Host ""
Write-Host "Testando conexão com PostgreSQL..." -ForegroundColor Yellow
$testResult = Execute-PostgreSqlCommand -command "SELECT version();" -database "postgres" -description "Testando conexão"

if (-not $testResult) {
    Write-Host "ERRO: Não foi possível conectar ao PostgreSQL" -ForegroundColor Red
    Write-Host "Verifique se o serviço está rodando e as credenciais estão corretas" -ForegroundColor Yellow
    exit 1
}

# Criar banco de dados
Write-Host ""
Write-Host "=== Criando banco de dados futsal_nautico ===" -ForegroundColor Green
$createDbResult = Execute-PostgreSqlCommand -command "CREATE DATABASE futsal_nautico;" -database "postgres" -description "Criando banco de dados futsal_nautico"

if ($createDbResult) {
    Write-Host "Banco de dados criado com sucesso!" -ForegroundColor Green
} else {
    Write-Host "Banco de dados já existe ou houve um erro" -ForegroundColor Yellow
}

# Criar tabelas
Write-Host ""
Write-Host "=== Criando tabelas ===" -ForegroundColor Green

# Ler e executar o schema.sql
$schemaPath = ".\database\schema.sql"
if (Test-Path $schemaPath) {
    Write-Host "Executando schema.sql..." -ForegroundColor Cyan
    try {
        $result = & "$binPath\psql.exe" -U postgres -d futsal_nautico -f "$schemaPath" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Schema criado com sucesso" -ForegroundColor Green
        } else {
            Write-Host "✗ Erro ao criar schema: $result" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "✗ Exceção ao criar schema: $_" -ForegroundColor Red
    }
} else {
    Write-Host "Arquivo schema.sql não encontrado em: $schemaPath" -ForegroundColor Red
}

# Inserir dados de teste
Write-Host ""
Write-Host "=== Inserindo dados de teste ===" -ForegroundColor Green

$testDataPath = ".\database\test-data.sql"
if (Test-Path $testDataPath) {
    Write-Host "Executando test-data.sql..." -ForegroundColor Cyan
    try {
        $result = & "$binPath\psql.exe" -U postgres -d futsal_nautico -f "$testDataPath" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Dados de teste inseridos com sucesso" -ForegroundColor Green
        } else {
            Write-Host "✗ Erro ao inserir dados: $result" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "✗ Exceção ao inserir dados: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "Arquivo test-data.sql não encontrado" -ForegroundColor Yellow
}

# Verificar tabelas criadas
Write-Host ""
Write-Host "=== Verificando tabelas criadas ===" -ForegroundColor Green
Execute-PostgreSqlCommand -command "\dt" -database "futsal_nautico" -description "Listando tabelas"

# Verificar dados
Write-Host ""
Write-Host "=== Verificando dados inseridos ===" -ForegroundColor Green
Execute-PostgreSqlCommand -command "SELECT COUNT(*) as total_players FROM players;" -database "futsal_nautico" -description "Total de jogadores"
Execute-PostgreSqlCommand -command "SELECT COUNT(*) as total_matches FROM matches;" -database "futsal_nautico" -description "Total de partidas"

Write-Host ""
Write-Host "=== Configuração concluída! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Próximos passos:" -ForegroundColor Cyan
Write-Host "1. Execute 'node database/test-connection-local.js' para testar a conexão" -ForegroundColor White
Write-Host "2. Configure as variáveis de ambiente no arquivo .env" -ForegroundColor White
Write-Host "3. Inicie o servidor backend com 'npm run dev'" -ForegroundColor White
Write-Host ""
Write-Host "Configuração do banco de dados:" -ForegroundColor Yellow
Write-Host "- Host: localhost" -ForegroundColor White
Write-Host "- Port: 5432" -ForegroundColor White
Write-Host "- Database: futsal_nautico" -ForegroundColor White
Write-Host "- User: postgres" -ForegroundColor White
Write-Host "- Password: [sua senha do postgres]" -ForegroundColor White

# Fim do script