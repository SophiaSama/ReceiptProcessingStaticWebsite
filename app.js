// ===================================================================================
// --- CONFIGURATION - IMPORTANT: Fill these values with your AWS resource details ---
// ===================================================================================
const config = {
    region: 'YOUR_AWS_REGION', // e.g., 'us-east-1'
    userPoolId: 'YOUR_COGNITO_USER_POOL_ID', // e.g., 'us-east-1_xxxxxxxxx'
    userPoolWebClientId: 'YOUR_COGNITO_APP_CLIENT_ID', // e.g., 'xxxxxxxxxxxxxxxxxxxxxxxxx'
    apiGatewayUploadUrl: 'YOUR_API_GATEWAY_UPLOAD_URL', // e.g., 'https://xxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/upload-url'
    apiGatewayReceiptsUrl: 'YOUR_API_GATEWAY_RECEIPTS_URL', // e.g., 'https://xxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/receipts'
};
// ===================================================================================

// --- DOM Elements ---
const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('loginButton');
const registerButton = document.getElementById('registerButton');
const confirmUi = document.getElementById('confirmUi');
const confirmRegisterButton = document.getElementById('confirmRegisterButton');
const verificationCodeInput = document.getElementById('verificationCode');
const authStatus = document.getElementById('authStatus');
const logoutButton = document.getElementById('logoutButton');
const currentUserSpan = document.getElementById('currentUser');
const receiptFile = document.getElementById('receiptFile');
const uploadButton = document.getElementById('uploadButton');
const uploadStatus = document.getElementById('uploadStatus');
const expenseTableBody = document.getElementById('expenseTable').getElementsByTagName('tbody')[0];

// --- Cognito SDK Initialization ---
const poolData = {
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolWebClientId
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
let cognitoUser;

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', checkUserSession);
loginButton.addEventListener('click', login);
registerButton.addEventListener('click', register);
confirmRegisterButton.addEventListener('click', confirmRegistration);
logoutButton.addEventListener('click', logout);
uploadButton.addEventListener('click', uploadReceipt);

// --- Authentication Logic ---

function showAuthSection() {
    authSection.style.display = 'block';
    appSection.style.display = 'none';
    confirmUi.style.display = 'none';
    authStatus.textContent = '';
}

async function showAppSection(session) {
    authSection.style.display = 'none';
    appSection.style.display = 'block';
    currentUserSpan.textContent = session.getIdToken().payload.email;
    await fetchExpenseLog(session.getIdToken().getJwtToken());
}

function checkUserSession() {
    cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
        cognitoUser.getSession(async (err, session) => {
            if (err || !session.isValid()) {
                showAuthSection();
            } else {
                await showAppSection(session);
            }
        });
    } else {
        showAuthSection();
    }
}

function register() {
    const attributeList = [new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'email', Value: usernameInput.value })];
    userPool.signUp(usernameInput.value, passwordInput.value, attributeList, null, (err, result) => {
        if (err) {
            authStatus.textContent = err.message || JSON.stringify(err);
            authStatus.style.color = 'red';
            return;
        }
        cognitoUser = result.user;
        authStatus.textContent = 'Registration successful! Please check your email for a verification code.';
        authStatus.style.color = 'green';
        confirmUi.style.display = 'block';
    });
}

function confirmRegistration() {
    cognitoUser.confirmRegistration(verificationCodeInput.value, true, (err, result) => {
        if (err) {
            authStatus.textContent = err.message || JSON.stringify(err);
            authStatus.style.color = 'red';
            return;
        }
        authStatus.textContent = 'Account confirmed successfully! Please log in.';
        authStatus.style.color = 'green';
        confirmUi.style.display = 'none';
    });
}

function login() {
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: usernameInput.value,
        Password: passwordInput.value,
    });
    cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: usernameInput.value, Pool: userPool });
    authStatus.textContent = 'Logging in...';
    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: async (session) => await showAppSection(session),
        onFailure: (err) => {
            authStatus.textContent = err.message || JSON.stringify(err);
            authStatus.style.color = 'red';
        },
    });
}

function logout() {
    if (cognitoUser) cognitoUser.signOut();
    showAuthSection();
}

// --- Application Logic ---

async function uploadReceipt() {
    const file = receiptFile.files[0];
    if (!file) {
        uploadStatus.textContent = 'Please select a file first.';
        uploadStatus.style.color = 'red';
        return;
    }

    uploadStatus.textContent = 'Preparing upload...';
    uploadStatus.style.color = 'orange';

    cognitoUser.getSession(async (err, session) => {
        if (err || !session.isValid()) {
            uploadStatus.textContent = 'Session expired. Please log in again.';
            uploadStatus.style.color = 'red';
            return;
        }

        try {
            // 1. Get a pre-signed URL from our backend
            const response = await fetch(config.apiGatewayUploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': session.getIdToken().getJwtToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ filename: file.name, contentType: file.type })
            });

            if (!response.ok) throw new Error('Could not get an upload URL.');

            const { uploadUrl } = await response.json();

            // 2. Upload the file directly to S3 using the pre-signed URL
            uploadStatus.textContent = 'Uploading...';
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            if (!uploadResponse.ok) throw new Error('File upload to S3 failed.');

            uploadStatus.textContent = 'Upload successful! Processing receipt...';
            uploadStatus.style.color = 'green';
            receiptFile.value = '';

            // 3. Refresh the log after a short delay to allow for processing
            setTimeout(() => fetchExpenseLog(session.getIdToken().getJwtToken()), 5000);

        } catch (error) {
            console.error('Upload process failed:', error);
            uploadStatus.textContent = `Upload failed: ${error.message}`;
            uploadStatus.style.color = 'red';
        }
    });
}

async function fetchExpenseLog(idToken) {
    expenseTableBody.innerHTML = '<tr><td colspan="4">Loading expenses...</td></tr>';
    try {
        const response = await fetch(config.apiGatewayReceiptsUrl, {
            headers: { 'Authorization': idToken }
        });
        if (!response.ok) throw new Error('Failed to fetch receipts.');
        
        const data = await response.json();
        displayExpenseLog(data.receipts);

    } catch (error) {
        console.error('Error fetching expense log:', error);
        expenseTableBody.innerHTML = `<tr><td colspan="4" style="color:red;">${error.message}</td></tr>`;
    }
}

function displayExpenseLog(receipts) {
    expenseTableBody.innerHTML = '';
    if (!receipts || receipts.length === 0) {
        expenseTableBody.innerHTML = '<tr><td colspan="4">No expenses recorded yet.</td></tr>';
        return;
    }

    receipts.sort((a, b) => new Date(b.uploadTimestamp) - new Date(a.uploadTimestamp));

    receipts.forEach(receipt => {
        const row = expenseTableBody.insertRow();
        const totalCost = (receipt.totalCost != null) ? `$${receipt.totalCost.toFixed(2)}` : 'N/A';
        const imageUrl = `https://${receipt.bucketName}.s3.${config.region}.amazonaws.com/${receipt.s3ObjectKey}`;

        row.insertCell().textContent = receipt.transactionDate || 'N/A';
        row.insertCell().textContent = totalCost;
        row.insertCell().textContent = new Date(receipt.uploadTimestamp).toLocaleString();
        
        const imageCell = row.insertCell();
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'Receipt thumbnail';
        img.onclick = () => window.open(imageUrl, '_blank');
        imageCell.appendChild(img);
    });
}
