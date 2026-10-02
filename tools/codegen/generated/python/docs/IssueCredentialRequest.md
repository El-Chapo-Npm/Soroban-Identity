# IssueCredentialRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Unique identifier for the credential | 
**subject** | **str** | Stellar public address of the credential subject | 
**issuer** | **str** | Stellar public address of the credential issuer | 
**expires_at** | **float** | Unix timestamp in seconds (0 &#x3D; no expiry) | [optional] 
**var_schema** | **str** | Schema URI | [optional] 
**claims** | **object** | Arbitrary claim dictionary | [optional] 

## Example

```python
from soroban_identity_client.models.issue_credential_request import IssueCredentialRequest

# TODO update the JSON string below
json = "{}"
# create an instance of IssueCredentialRequest from a JSON string
issue_credential_request_instance = IssueCredentialRequest.from_json(json)
# print the JSON string representation of the object
print(IssueCredentialRequest.to_json())

# convert the object into a dict
issue_credential_request_dict = issue_credential_request_instance.to_dict()
# create an instance of IssueCredentialRequest from a dict
issue_credential_request_from_dict = IssueCredentialRequest.from_dict(issue_credential_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


