const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    alert('WebGL not supported');
}

// Vertex shader source
const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

// Fragment shader source
const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform vec2 u_texScale;
    varying vec2 v_texCoord;
    void main() {
        gl_FragColor = texture2D(u_texture, v_texCoord * u_texScale);
    }
`;

// Create shader function
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create program function
function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Error linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

// Create shaders
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

// Create program
const program = createProgram(gl, vertexShader, fragmentShader);

// Get attribute locations
const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
const texCoordAttributeLocation = gl.getAttribLocation(program, 'a_texCoord');

// Get uniform locations
const textureUniformLocation = gl.getUniformLocation(program, 'u_texture');
const texScaleLocation = gl.getUniformLocation(program, 'u_texScale');

// Load texture function
function loadTexture(gl, url, callback, flipY = false) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Placeholder magenta
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
    const image = new Image();
    image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (flipY) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        callback(image.width, image.height);
    };
    image.src = url;
    return texture;
}

// Load textures
let grassWidth = 64, grassHeight = 64; // default
const grassTexture = loadTexture(gl, 'media/tile-grass.png', (w, h) => {
    grassWidth = w;
    grassHeight = h;
}, true); // flip Y for grass

let fieldWidth = 100, fieldHeight = 100; // default
const fieldTexture = loadTexture(gl, 'media/field.png', (w, h) => {
    fieldWidth = w;
    fieldHeight = h;
    objectWidth = (w / canvas.width) * 2;
    objectHeight = (h / canvas.height) * 2;
}, false); // no flip for field

// Object properties
let objectX = 0;
let objectY = 0;
let objectWidth = 0.2; // default
let objectHeight = 0.2; // default

// Buffers
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

const objectPositionBuffer = gl.createBuffer();
const objectTexCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

// Mouse handling
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const displayedWidth = rect.width;
    const displayedHeight = rect.height;
    const glX = (mouseX / displayedWidth) * 2 - 1;
    const glY = 1 - (mouseY / displayedHeight) * 2;
    if (glX >= objectX - objectWidth / 2 && glX <= objectX + objectWidth / 2 &&
        glY >= objectY - objectHeight / 2 && glY <= objectY + objectHeight / 2) {
        dragging = true;
        dragOffsetX = glX - objectX;
        dragOffsetY = glY - objectY;
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (dragging) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const displayedWidth = rect.width;
        const displayedHeight = rect.height;
        const glX = (mouseX / displayedWidth) * 2 - 1;
        const glY = 1 - (mouseY / displayedHeight) * 2;
        objectX = glX - dragOffsetX;
        objectY = glY - dragOffsetY;
    }
});

canvas.addEventListener('mouseup', () => {
    dragging = false;
});

canvas.focus();

// Render function
function render() {
    if (!grassWidth || !fieldWidth) {
        requestAnimationFrame(render);
        return;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(program);

    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.enableVertexAttribArray(texCoordAttributeLocation);

    // Draw background
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, grassTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.uniform1i(textureUniformLocation, 0);
    gl.uniform2f(texScaleLocation, canvas.width / grassWidth, canvas.height / grassHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Draw object
    const objectPositions = [
        objectX - objectWidth / 2, objectY - objectHeight / 2,
        objectX + objectWidth / 2, objectY - objectHeight / 2,
        objectX - objectWidth / 2, objectY + objectHeight / 2,
        objectX + objectWidth / 2, objectY + objectHeight / 2,
    ];
    gl.bindBuffer(gl.ARRAY_BUFFER, objectPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(objectPositions), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
    gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform2f(texScaleLocation, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

render();