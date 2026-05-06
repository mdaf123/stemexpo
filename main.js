const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

ctx.fillStyle = "silver";
ctx.fillRect(0, 0, canvas.width, canvas.height);

let down = false;

canvas.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Enter') {
        down = true;
        ctx.fillStyle = "green";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
});

canvas.addEventListener('keyup', (e) => {
    e.preventDefault();
    if (e.key === 'Enter') {
        down = false;
        setTimeout(() => {
            if (!down) {
                ctx.fillStyle = "silver";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }, 50)
    }
});

canvas.focus();