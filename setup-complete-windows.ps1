# Script de Setup Completo - Futsal D'Domingo (Windows)
# Instala dependências e configura PostgreSQL

Write-Host "🚀 Setup Completo - Futsal D'Domingo" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue
Write-Host ""

# Funções para output colorido
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }

# Configurações
$PG_PATH = "C:\Program Files\PostgreSQL\16\bin"
$DB_NAME = "futsal_domingo"
$DB_USER = "postgres"

# Verificar Node.js
function Check-Node {
    try {
        $nodeVersion = node --version
        Write-Success "Node.js encontrado: $nodeVersion"
        return $true
    } catch {
        Write-Error "Node.js não encontrado!"
        Write-Info "Por favor, instale o Node.js: https://nodejs.org/"
        return $false
    }
}

# Verificar npm
function Check-Npm {
    try {
        $npmVersion = npm --version
        Write-Success "npm encontrado: $npmVersion"
        return $true
    } catch {
        Write-Error "npm não encontrado!"
        return $false
    }
}

# Instalar dependências do projeto
function Install-Dependencies {
    Write-Info "Instalando dependências do projeto..."
    
    # Criar package.json principal se não existir
    if (-not (Test-Path "package.json")) {
        Write-Info "Criando package.json principal..."
        $packageJson = @"
{
  "name": "futsal-domingo",
  "version": "1.0.0",
  "description": "Sistema de gerenciamento de partidas de futsal aos domingos",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "db:setup": "node database/setup.js",
    "db:test": "node database/test-connection-local.js",
    "db:reset": "node database/setup.js",
    "db:seed": "psql -U postgres -d futsal_domingo -f database/test_data.sql",
    "db:backup": "pg_dump -U postgres -d futsal_domingo > backup_$(Get-Date -Format yyyyMMdd_HHmmss).sql",
    "db:shell": "psql -U postgres -d futsal_domingo"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "socket.io": "^4.7.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "keywords": [
    "futsal",
    "sports",
    "management",
    "nodejs",
    "postgresql"
  ],
  "author": "Futsal D'Domingo",
  "license": "MIT"
}
"@
        $packageJson | Out-File -FilePath "package.json" -Encoding UTF8
        Write-Success "package.json criado!"
    }
    
    # Instalar dependências
    Write-Info "Instalando dependências... (isso pode levar alguns minutos)"
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Dependências instaladas com sucesso!"
        return $true
    } else {
        Write-Error "Erro ao instalar dependências."
        return $false
    }
}

# Criar arquivo .env
function Create-EnvFile {
    Write-Info "Criando arquivo .env..."
    
    if (-not (Test-Path ".env")) {
        $timestamp = Get-Date -Format "yyyyMMddHHmmss"
        $envContent = @"
# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui_$timestamp
MASTER_PASSWORD_HASH=`$2b`$10`$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

# Servidor
PORT=3001
NODE_ENV=development

# Configurações do Jogo
MATCH_DURATION_MINUTES=10
MAX_PLAYERS_PER_TEAM=5
SESSION_DURATION_MINUTES=120
"@
        
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Arquivo .env criado!"
        Write-Warning "Por favor, edite o arquivo .env e configure sua senha do PostgreSQL."
    } else {
        Write-Warning "Arquivo .env já existe."
    }
}

# Verificar PostgreSQL
function Check-PostgreSQL {
    if (Test-Path "$PG_PATH\psql.exe") {
        Write-Success "PostgreSQL encontrado em: $PG_PATH"
        return $true
    } else {
        Write-Error "PostgreSQL não encontrado em: $PG_PATH"
        Write-Info "Por favor, instale o PostgreSQL 16 ou ajuste o caminho no script."
        return $false
    }
}

# Verificar se o serviço está rodando
function Check-Service {
    $serviceName = "postgresql-x64-16"
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    
    if ($service -and $service.Status -eq 'Running') {
        Write-Success "Serviço PostgreSQL está rodando!"
        return $true
    } else {
        Write-Warning "Serviço PostgreSQL não está rodando."
        Write-Info "Tentando iniciar o serviço..."
        
        try {
            Start-Service -Name $serviceName -ErrorAction Stop
            Start-Sleep -Seconds 5
            Write-Success "Serviço iniciado com sucesso!"
            return $true
        } catch {
            Write-Error "Não foi possível iniciar o serviço: $_"
            Write-Info "Por favor, inicie o serviço manualmente ou verifique as permissões."
            return $false
        }
    }
}

# Criar banco de dados
function Create-Database {
    Write-Info "Criando banco de dados '$DB_NAME'..."
    
    try {
        # Verificar se o banco já existe
        $existingDb = & "$PG_PATH\psql.exe" -U $DB_USER -t -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" 2>$null
        
        if ($existingDb -and $existingDb.Trim() -eq "1") {
            Write-Warning "Banco de dados '$DB_NAME' já existe."
            $recreate = Read-Host "Deseja recriar o banco? (s/n)"
            
            if ($recreate -eq 's' -or $recreate -eq 'S') {
                Write-Info "Dropando banco existente..."
                & "$PG_PATH\psql.exe" -U $DB_USER -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>$null
                
                Write-Info "Criando novo banco..."
                & "$PG_PATH\psql.exe" -U $DB_USER -c "CREATE DATABASE $DB_NAME;" 2>$null
                Write-Success "Banco de dados recriado com sucesso!"
            } else {
                Write-Info "Usando banco de dados existente."
            }
        } else {
            Write-Info "Criando banco de dados..."
            & "$PG_PATH\psql.exe" -U $DB_USER -c "CREATE DATABASE $DB_NAME;" 2>$null
            Write-Success "Banco de dados criado com sucesso!"
        }
        return $true
    } catch {
        Write-Error "Erro ao criar banco de dados: $_"
        return $false
    }
}

# Aplicar schema
function Apply-Schema {
    Write-Info "Aplicando schema do banco de dados..."
    
    $schemaPath = "database\schema.sql"
    
    if (Test-Path $schemaPath) {
        try {
            Write-Info "Executando schema.sql..."
            & "$PG_PATH\psql.exe" -U $DB_USER -d $DB_NAME -f $schemaPath
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Schema aplicado com sucesso!"
                return $true
            } else {
                Write-Error "Erro ao aplicar schema. Verifique o arquivo schema.sql"
                return $false
            }
        } catch {
            Write-Error "Erro ao aplicar schema: $_"
            return $false
        }
    } else {
        Write-Error "Arquivo schema.sql não encontrado: $schemaPath"
        return $false
    }
}

# Inserir dados de teste
function Insert-TestData {
    Write-Info "Inserindo dados de teste..."
    
    $testDataPath = "database\test_data.sql"
    
    if (Test-Path $testDataPath) {
        try {
            Write-Info "Executando test_data.sql..."
            & "$PG_PATH\psql.exe" -U $DB_USER -d $DB_NAME -f $testDataPath
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Dados de teste inseridos com sucesso!"
            } else {
                Write-Warning "Erro ao inserir dados de teste."
            }
        } catch {
            Write-Warning "Erro ao inserir dados de teste: $_"
        }
    } else {
        Write-Warning "Arquivo test_data.sql não encontrado: $testDataPath"
    }
}

# Verificar instalação
function Verify-Installation {
    Write-Info "Verificando instalação..."
    
    try {
        # Testar conexão
        $result = & "$PG_PATH\psql.exe" -U $DB_USER -d $DB_NAME -c "SELECT NOW();" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Conexão com banco de dados estabelecida!"
        } else {
            Write-Error "Erro ao conectar ao banco de dados."
            return $false
        }
        
        # Verificar tabelas
        Write-Info "Verificando tabelas criadas..."
        $tables = & "$PG_PATH\psql.exe" -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>$null
        
        if ($tables) {
            Write-Info "Tabelas criadas: $($tables.Trim())"
            
            # Listar tabelas
            Write-Info "Tabelas do banco:"
            & "$PG_PATH\psql.exe" -U $DB_USER -d $DB_NAME -c "\dt" 2>$null
        }
        
        return $true
    } catch {
        Write-Error "Erro durante verificação: $_"
        return $false
    }
}

# Testar conexão com Node.js
function Test-NodeConnection {
    Write-Info "Testando conexão com Node.js..."
    
    if (Test-Path "database\test-connection-local.js") {
        try {
            node database\test-connection-local.js
            return $true
        } catch {
            Write-Warning "Erro ao testar conexão com Node.js: $_"
            return $false
        }
    } else {
        Write-Warning "Script de teste não encontrado."
        return $false
    }
}

# Função principal
function Main {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host "  🏆 FUTSAL D'DOMINGO - SETUP COMPLETO" -ForegroundColor Blue
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host ""
    
    # Verificar Node.js e npm
    if (-not (Check-Node)) {
        return
    }
    if (-not (Check-Npm)) {
        return
    }
    
    # Instalar dependências
    if (-not (Install-Dependencies)) {
        return
    }
    
    # Criar .env
    Create-EnvFile
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host "  🗄️  CONFIGURAÇÃO DO BANCO DE DADOS" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host ""
    
    # Verificar PostgreSQL
    if (-not (Check-PostgreSQL)) {
        return
    }
    
    # Verificar serviço
    if (-not (Check-Service)) {
        return
    }
    
    Write-Host ""
    Write-Host "⚠️  IMPORTANTE: Configure sua senha do PostgreSQL no arquivo .env antes de continuar!" -ForegroundColor Yellow
    Write-Host "   Arquivo: .env" -ForegroundColor Yellow
    Write-Host "   Campo: DB_PASSWORD=sua_senha_aqui" -ForegroundColor Yellow
    Write-Host ""
    
    $continue = Read-Host "Você configurou a senha do PostgreSQL? (s/n)"
    if ($continue -ne 's' -and $continue -ne 'S') {
        Write-Info "Por favor, configure a senha no arquivo .env e execute este script novamente."
        return
    }
    
    # Criar banco de dados
    if (-not (Create-Database)) {
        return
    }
    
    # Aplicar schema
    if (-not (Apply-Schema)) {
        return
    }
    
    # Inserir dados de teste
    $insertData = Read-Host "Deseja inserir dados de teste? (s/n)"
    if ($insertData -eq 's' -or $insertData -eq 'S') {
        Insert-TestData
    }
    
    # Verificar instalação
    if (-not (Verify-Installation)) {
        return
    }
    
    # Testar conexão com Node.js
    $testConn = Read-Host "Deseja testar a conexão com Node.js? (s/n)"
    if ($testConn -eq 's' -or $testConn -eq 'S') {
        Test-NodeConnection
    }
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "🎉 SETUP COMPLETO CONCLUÍDO!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Info "Próximos passos:"
    Write-Host "1. ✅ Banco de dados configurado com sucesso!"
    Write-Host "2. ✅ Dependências instaladas!"
    Write-Host "3. 📋 Configure o backend (API) conforme necessário"
    Write-Host "4. 🎨 Configure o frontend (React) conforme necessário"
    Write-Host "5. 🚀 Execute 'npm run dev' para iniciar o servidor"
    Write-Host ""
    Write-Info "Comandos úteis:"
    Write-Host "- npm run db:test    # Testar conexão com banco"
    Write-Host "- npm run db:seed    # Inserir mais dados de teste"
    Write-Host "- npm run db:shell   # Acessar console PostgreSQL"
    Write-Host ""
    Write-Info "PostgreSQL:"
    Write-Host "- & `"$PG_PATH\psql.exe`" -U postgres -d futsal_domingo  # Acessar banco"
    Write-Host "- & `"$PG_PATH\psql.exe`" -U postgres -d futsal_domingo -c `"\dt`"  # Ver tabelas"
    Write-Host "- & `"$PG_PATH\psql.exe`" -U postgres -d futsal_domingo -c `"SELECT * FROM player_ranking;`"  # Ver ranking"
    Write-Host ""
}

# Executar o script
Main