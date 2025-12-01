require("dotenv").config();
const axios = require("axios");

(async () => {
  try {
    // 1. Get Session Token
    console.log("📡 Authenticating with Tripletex...");

    const expirationDate = new Date(new Date().getFullYear(), 11, 31)
      .toISOString()
      .slice(0, 10);

    const tokenResponse = await axios({
      method: 'put',
      url: `${process.env.BASE_URL}/token/session/:create?consumerToken=${process.env.CONSUMER_TOKEN}&employeeToken=${process.env.EMPLOYEE_TOKEN}&expirationDate=${expirationDate}`,
    });

    const sessionToken = tokenResponse.data.value.token;
    console.log("✅ Session token received.");

    // 2. Prepare for API calls
    const basicAuth = Buffer.from(`0:${sessionToken}`).toString('base64');
    const apiClient = axios.create({
      baseURL: process.env.BASE_URL,
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });

    // 3. Fetch customers
    console.log("🔄 Fetching customers from Tripletex...");
    const customersResponse = await apiClient.get("/customer", {
      params: {
        from: 0,
        count: 5, // Fetching only 5 for this test
      },
    });

    console.log("✅ Successfully fetched customers:");
    console.log(customersResponse.data.values.map(c => ({
        id: c.id,
        number: c.customerNumber,
        name: c.name
    })));

  } catch (e) {
    console.error("❌ An error occurred:");
    console.error(e.response?.data || e.message);
    process.exit(1);
  }
})();