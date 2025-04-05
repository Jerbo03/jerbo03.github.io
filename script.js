<script>
// Configuración de Ubidots para API v1.6
const UBIDOTS_CONFIG = {
  DEVICE_LABEL: "wroom",
  ACTION_LABEL: "action",
  TARGET_LABEL: "target",
  COMPASS_LABEL: "compass",
  AUTH_TOKEN: "BBUS-RKTYrxzxAxCmaOoi8yBwspZHE2snC1",
  API_URL: "https://industrial.api.ubidots.com/api/v1.6",
  COMMAND_MAP: {
    'F': 1,  // Forward
    'B': 2,  // Backwards
    'L': 3,  // Left
    'R': 4,  // Right
    'S': 0,  // Stop
    'H': 5   // Point to heading
  },
  POLLING_INTERVAL: 5000 // 1 second between checks
};

// Enviar comando STOP al cargar la página
document.addEventListener('DOMContentLoaded', async function() {
  try {
    const response = await sendStopCommand();
    addServerResponse("STOP inicial enviado", response);
  } catch (error) {
    console.error("Error al enviar STOP inicial:", error);
    addServerResponse("Error al enviar STOP inicial", error.message, true);
  }
});

document.getElementById('updateButton').addEventListener('click', function() {
  const commandString = document.getElementById('valueInput').value.trim().toUpperCase();
  const statusElement = document.getElementById('statusMessage');
  
  // Limpiar mensajes anteriores
  statusElement.className = "status";
  statusElement.textContent = "";
  clearCommandLog();
  
  // Validar entrada
  if (!commandString) {
    showError(statusElement, "Por favor ingresa comandos válidos");
    return;
  }

  // Procesar comandos
  processCommands(commandString, statusElement);
});

async function processCommands(commandString, statusElement) {
  try {
    const commands = normalizeCommands(commandString);
    statusElement.textContent = "Procesando comandos...";
    logCommands(commands);
    
    for (const cmd of commands) {
      if (cmd.action === 'H') {
        // Send heading command and wait for completion
        const response = await sendHeadingCommand(cmd.value);
        addServerResponse(`Comando H${cmd.value} ejecutado`, response);
        
        // Wait until target becomes -1
        await waitForHeadingCompletion();
      } else {
        // Normal movement command
        const response = await executeCommand(cmd.action, cmd.value);
        addServerResponse(`Comando ${cmd.action}${cmd.value} ejecutado`, response);
      }
    }
    
    // Final STOP command
    const stopResponse = await sendStopCommand();
    addServerResponse("STOP final enviado", stopResponse);
    showSuccess(statusElement, "¡Todos los comandos ejecutados!");
    
  } catch (error) {
    console.error("Error:", error);
    showError(statusElement, `Error: ${error.message}`);
    addServerResponse("Error en ejecución", error.message, true);
    try {
      await sendStopCommand();
    } catch (stopError) {
      addServerResponse("Error al enviar STOP de emergencia", stopError.message, true);
    }
  }
}

async function waitForHeadingCompletion() {
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds timeout
  
  addServerResponse("Esperando a que el carrito complete el giro...", "");
  
  while (attempts < maxAttempts) {
    attempts++;
    
    // Get current target value
    const targetValue = await getUbidotsVariable(UBIDOTS_CONFIG.TARGET_LABEL);
    addServerResponse(`Estado actual (intento ${attempts}):`, `Target: ${targetValue}`);
    
    if (targetValue === -1) {
      addServerResponse("¡Giro completado!", "");
      return;
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, UBIDOTS_CONFIG.POLLING_INTERVAL));
  }
  
  throw new Error("Tiempo de espera agotado para completar el giro");
}

async function getUbidotsVariable(variableLabel) {
  const url = `${UBIDOTS_CONFIG.API_URL}/devices/${UBIDOTS_CONFIG.DEVICE_LABEL}/${variableLabel}/values?page_size=1`;
  
  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': UBIDOTS_CONFIG.AUTH_TOKEN
    }
  });

  if (!response.ok) {
    throw new Error(`Error al obtener variable: ${response.status}`);
  }

  const data = await response.json();
  return data.results[0]?.value ?? null;
}

function normalizeCommands(commandString) {
  // Dividir por comas y limpiar espacios
  const parts = commandString.split(',').map(part => part.trim());
  const validCommands = [];
  
  // Procesar cada parte
  for (const part of parts) {
    if (!part) continue;
    
    // Extraer letra de comando (puede ser mayúscula o minúscula)
    const actionMatch = part.match(/^([A-Za-z])/i);
    // Extraer valor numérico (entero o decimal)
    const valueMatch = part.match(/(\d+\.?\d*|\.\d+)$/);
    
    // Determinar acción (default: 'S' para STOP)
    let action = actionMatch ? actionMatch[1].toUpperCase() : 'S';
    
    // Determinar valor (default: 1.0 para movimientos, 0 para heading)
    let value = (action === 'H') ? 0 : 1.0;
    if (valueMatch) {
      value = parseFloat(valueMatch[1]);
      // Validar que el valor sea positivo para movimientos
      if (value <= 0 && action !== 'H') value = 1.0;
    }
    
    // Validar acción
    if (!UBIDOTS_CONFIG.COMMAND_MAP.hasOwnProperty(action)) {
      action = 'S';
    }
    
    validCommands.push({
      action: action,
      value: value
    });
  }
  
  return validCommands;
}

async function executeCommand(action, duration) {
  const numericValue = UBIDOTS_CONFIG.COMMAND_MAP[action];
  
  // Enviar comando de acción a Ubidots
  const response = await updateUbidotsVariable(UBIDOTS_CONFIG.ACTION_LABEL, numericValue);
  
  // Si es un comando de movimiento, esperar la duración especificada
  if (action !== 'H' && action !== 'S') {
    await new Promise(resolve => setTimeout(resolve, duration * 1000));
  }
  
  return response;
}

async function sendHeadingCommand(angle) {
  // Validar ángulo (0-359 o -1)
  angle = (angle >= 0 && angle <= 359) ? angle : -1;
  
  // 1. Primero enviar el ángulo objetivo
  await updateUbidotsVariable(UBIDOTS_CONFIG.TARGET_LABEL, angle);
  
  // 2. Luego enviar el comando de apuntar
  const response = await updateUbidotsVariable(
    UBIDOTS_CONFIG.ACTION_LABEL, 
    UBIDOTS_CONFIG.COMMAND_MAP['H']
  );
  
  return response;
}

async function sendStopCommand() {
  return await updateUbidotsVariable(UBIDOTS_CONFIG.ACTION_LABEL, UBIDOTS_CONFIG.COMMAND_MAP['S']);
}

async function updateUbidotsVariable(variableLabel, value) {
  const url = `${UBIDOTS_CONFIG.API_URL}/devices/${UBIDOTS_CONFIG.DEVICE_LABEL}/${variableLabel}/values`;
  
  const payload = {
    value: value,
    context: {
      timestamp: new Date().toISOString(),
      source: "web-controller"
    }
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': UBIDOTS_CONFIG.AUTH_TOKEN
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || `Error HTTP: ${response.status}`);
  }

  return await response.json();
}

function logCommands(commands) {
  const logElement = document.getElementById('commandLog');
  
  commands.forEach(cmd => {
    const cmdText = {
      'F': 'Adelante',
      'B': 'Atrás',
      'L': 'Izquierda',
      'R': 'Derecha',
      'S': 'Detener',
      'H': 'Apuntar a'
    }[cmd.action];
    
    let valueText = cmd.value;
    if (cmd.action === 'H') {
      valueText = (cmd.value === -1) ? "desactivado" : `${cmd.value}°`;
    } else {
      valueText = `${cmd.value} segundos`;
    }
    
    addCommandItem(`${cmdText} (${cmd.action}${cmd.value}) - ${valueText}`);
  });
}

function addCommandItem(text) {
  const logElement = document.getElementById('commandLog');
  const item = document.createElement('div');
  item.className = 'command-item';
  item.textContent = text;
  logElement.appendChild(item);
}

function addServerResponse(title, response, isError = false) {
  const logElement = document.getElementById('commandLog');
  const item = document.createElement('div');
  item.className = `server-response ${isError ? 'error-response' : ''}`;
  
  const titleElement = document.createElement('strong');
  titleElement.textContent = `${title}: `;
  
  const contentElement = document.createElement('span');
  contentElement.textContent = typeof response === 'object' 
    ? JSON.stringify(response, null, 2) 
    : response;
  
  item.appendChild(titleElement);
  item.appendChild(contentElement);
  logElement.appendChild(item);
  
  // Auto-scroll al final
  logElement.scrollTop = logElement.scrollHeight;
}

function clearCommandLog() {
  document.getElementById('commandLog').innerHTML = '';
}

function showSuccess(element, message) {
  element.textContent = message;
  element.classList.add("success");
}

function showError(element, message) {
  element.textContent = message;
  element.classList.add("error");
}
</script>
